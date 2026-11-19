begin;

alter table public.tiershelf_entries
  add column if not exists extra_pokemon_ids integer[] not null default '{}' check (
    cardinality(extra_pokemon_ids) <= 19
    and coalesce(array_ndims(extra_pokemon_ids), 1) = 1
    and array_position(extra_pokemon_ids, null) is null
    and 0 < all(extra_pokemon_ids) and 20001 > all(extra_pokemon_ids)
  );

alter table public.tiershelf_queue
  add column if not exists extra_pokemon_ids integer[] not null default '{}' check (
    (source = 'recommended' or cardinality(extra_pokemon_ids) = 0)
    and cardinality(extra_pokemon_ids) <= 19
    and coalesce(array_ndims(extra_pokemon_ids), 1) = 1
    and array_position(extra_pokemon_ids, null) is null
    and 0 < all(extra_pokemon_ids) and 20001 > all(extra_pokemon_ids)
  );

grant insert (extra_pokemon_ids), update (extra_pokemon_ids)
  on public.tiershelf_entries, public.tiershelf_queue to authenticated;

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
  if access_key is null or pg_catalog.char_length(access_key) not between 7 and 128 then
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
    'source_queue_id', to_jsonb(e)->'source_queue_id', 'extra_pokemon_ids', e.extra_pokemon_ids
  ) order by e.created_at, e.id), '[]'::jsonb)
  into shelf
  from public.tiershelf_entries e where e.user_id = owner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'title', q.title, 'media_type', q.media_type, 'author', q.author,
    'source', q.source, 'pokemon_id', q.pokemon_id, 'artwork_url', to_jsonb(q)->'artwork_url',
    'queue_position', to_jsonb(q)->'queue_position', 'reading_tags', to_jsonb(q)->'reading_tags', 'extra_pokemon_ids', q.extra_pokemon_ids
  ) order by q.created_at, q.id), '[]'::jsonb)
  into questlog
  from public.tiershelf_queue q where q.user_id = owner_id;

  return jsonb_build_object('shelf', shelf, 'questlog', questlog);
end;
$$;

notify pgrst, 'reload schema';
commit;
