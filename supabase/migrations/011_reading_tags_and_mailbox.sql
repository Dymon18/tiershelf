begin;

create table if not exists public.tiershelf_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  sender text not null check (char_length(btrim(sender)) between 1 and 100),
  author text check (author is null or char_length(btrim(author)) between 1 and 200),
  note text check (note is null or char_length(btrim(note)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists tiershelf_recommendations_owner_created_idx
  on public.tiershelf_recommendations (user_id, created_at desc, id);

alter table public.tiershelf_recommendations enable row level security;
revoke all privileges on public.tiershelf_recommendations from public, anon, authenticated;
grant select on public.tiershelf_recommendations to authenticated;

drop policy if exists "Dymon reads private recommendations" on public.tiershelf_recommendations;
create policy "Dymon reads private recommendations" on public.tiershelf_recommendations
  for select to authenticated
  using ((select public.tiershelf_is_owner()) and user_id = (select auth.uid()));

alter table public.tiershelf_queue
  add column if not exists reading_tags text[] not null default '{}' check (
    (media_type = 'book' or cardinality(reading_tags) = 0)
    and cardinality(reading_tags) <= 6
    and array_position(reading_tags, null) is null
    and reading_tags <@ array['cozy', 'gut-wrenching', 'fast-paced', 'slow-paced',
      'straightforward', 'light-read']::text[]
  ),
  add column if not exists source_recommendation_id uuid
    references public.tiershelf_recommendations (id) on delete set null
    check (source_recommendation_id is null or (media_type = 'book' and source = 'recommended'));

create unique index if not exists tiershelf_queue_source_recommendation_idx
  on public.tiershelf_queue (source_recommendation_id) where source_recommendation_id is not null;

grant insert (reading_tags, source_recommendation_id), update (reading_tags)
  on public.tiershelf_queue to authenticated;

create or replace function public.tiershelf_submit_recommendation(
  access_key text, book_title text, recommender_name text, book_author text, recommendation_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  title_value text := pg_catalog.btrim(book_title, E' \t\r\n');
  sender_value text := pg_catalog.btrim(recommender_name, E' \t\r\n');
  author_value text := nullif(pg_catalog.btrim(book_author, E' \t\r\n'), '');
  note_value text := nullif(pg_catalog.btrim(recommendation_note, E' \t\r\n'), '');
begin
  if access_key is null or pg_catalog.char_length(access_key) not between 7 and 128 then
    return false;
  end if;

  select k.user_id into owner_id
    from public.tiershelf_viewer_keys k
    where k.key_hash = pg_catalog.sha256(pg_catalog.convert_to(access_key, 'UTF8'))
    for share;
  if not found then return false; end if;

  if title_value is null or pg_catalog.char_length(title_value) not between 1 and 200
    or sender_value is null or pg_catalog.char_length(sender_value) not between 1 and 100
    or pg_catalog.char_length(author_value) > 200
    or pg_catalog.char_length(note_value) > 1000 then
    raise exception 'Enter a book title and your name within the field limits' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(238472, pg_catalog.hashtext(owner_id::text));
  if (select count(*) from public.tiershelf_recommendations r
      where r.user_id = owner_id and r.created_at > now() - interval '1 minute') >= 12 then
    raise exception 'Try again in a minute' using errcode = 'P0001';
  end if;

  insert into public.tiershelf_recommendations (user_id, title, sender, author, note)
    values (owner_id, title_value, sender_value, author_value, note_value);
  return true;
end;
$$;

revoke all on function public.tiershelf_submit_recommendation(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.tiershelf_submit_recommendation(text, text, text, text, text)
  to anon, authenticated;

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
    'source_queue_id', to_jsonb(e)->'source_queue_id'
  ) order by e.created_at, e.id), '[]'::jsonb)
  into shelf
  from public.tiershelf_entries e where e.user_id = owner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'title', q.title, 'media_type', q.media_type, 'author', q.author,
    'source', q.source, 'pokemon_id', q.pokemon_id, 'artwork_url', to_jsonb(q)->'artwork_url',
    'queue_position', to_jsonb(q)->'queue_position', 'reading_tags', q.reading_tags
  ) order by q.created_at, q.id), '[]'::jsonb)
  into questlog
  from public.tiershelf_queue q where q.user_id = owner_id;

  return jsonb_build_object('shelf', shelf, 'questlog', questlog);
end;
$$;

notify pgrst, 'reload schema';
commit;
