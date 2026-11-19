begin;

create table if not exists public.tiershelf_viewer_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key_hash bytea not null unique
);

alter table public.tiershelf_viewer_keys enable row level security;
revoke all privileges on public.tiershelf_viewer_keys from public, anon, authenticated;

create or replace function public.tiershelf_set_viewer_key(access_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null or not public.tiershelf_is_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  if access_key is null then
    delete from public.tiershelf_viewer_keys where user_id = owner_id;
    return false;
  end if;
  if access_key !~ '^Kuching-[A-Za-z0-9_-]{32}$' then
    raise exception 'Generate a key from Viewer access' using errcode = '22023';
  end if;

  insert into public.tiershelf_viewer_keys (user_id, key_hash)
    values (owner_id, pg_catalog.sha256(pg_catalog.convert_to(access_key, 'UTF8')))
    on conflict (user_id) do update set key_hash = excluded.key_hash;
  return true;
end;
$$;

create or replace function public.tiershelf_viewer_snapshot(access_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  shelf jsonb;
  questlog jsonb;
begin
  if access_key is null or access_key !~ '^Kuching-[A-Za-z0-9_-]{32}$' then
    return null;
  end if;

  select k.user_id into owner_id
    from public.tiershelf_viewer_keys k
    where k.key_hash = pg_catalog.sha256(pg_catalog.convert_to(access_key, 'UTF8'));
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'title', e.title, 'media_type', e.media_type, 'grade', e.grade,
    'author', to_jsonb(e)->'author', 'poster_url', to_jsonb(e)->'poster_url',
    'categories', to_jsonb(e)->'categories', 'release_year', to_jsonb(e)->'release_year',
    'tier_position', to_jsonb(e)->'tier_position',
    'movie_details', jsonb_strip_nulls(jsonb_build_object(
      'directors', to_jsonb(e)->'movie_details'->'directors',
      'studios', to_jsonb(e)->'movie_details'->'studios',
      'franchises', to_jsonb(e)->'movie_details'->'franchises',
      'languages', to_jsonb(e)->'movie_details'->'languages',
      'countries', to_jsonb(e)->'movie_details'->'countries',
      'runtime', to_jsonb(e)->'movie_details'->'runtime'
    )),
    'recommender_pokemon_id', to_jsonb(e)->'recommender_pokemon_id',
    'source_queue_id', to_jsonb(e)->'source_queue_id'
  ) order by e.created_at, e.id), '[]'::jsonb)
  into shelf
  from public.tiershelf_entries e where e.user_id = owner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'title', q.title, 'media_type', q.media_type, 'author', q.author,
    'source', q.source, 'pokemon_id', q.pokemon_id, 'artwork_url', to_jsonb(q)->'artwork_url',
    'queue_position', to_jsonb(q)->'queue_position'
  ) order by q.created_at, q.id), '[]'::jsonb)
  into questlog
  from public.tiershelf_queue q where q.user_id = owner_id;

  return jsonb_build_object('shelf', shelf, 'questlog', questlog);
end;
$$;

revoke all on function public.tiershelf_set_viewer_key(text) from public, anon, authenticated;
grant execute on function public.tiershelf_set_viewer_key(text) to authenticated;
revoke all on function public.tiershelf_viewer_snapshot(text) from public, anon, authenticated;
grant execute on function public.tiershelf_viewer_snapshot(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
