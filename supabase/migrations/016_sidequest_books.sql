begin;

create or replace function public.tiershelf_valid_custom_reading_tags(tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(tags) <= 30 and coalesce(array_ndims(tags), 1) = 1
    and count(*) = count(distinct lower(tag))
    and coalesce(bool_and(tag = btrim(tag) and char_length(tag) between 1 and 48), true)
  from unnest(tags) as names(tag);
$$;

alter table public.tiershelf_queue
  add column if not exists reading_status text check (
    reading_status is null or (media_type = 'book' and source = 'recommended'
      and reading_status in ('in-progress', 'next-up', 'waiting-on-library', 'request-needed'))
  ),
  add column if not exists custom_reading_tags text[] not null default '{}' check (
    (media_type = 'book' or cardinality(custom_reading_tags) = 0)
    and public.tiershelf_valid_custom_reading_tags(custom_reading_tags)
  ),
  add column if not exists synopsis_url text check (
    synopsis_url is null or (media_type = 'book' and char_length(synopsis_url) <= 2000
      and synopsis_url ~ '^https://[^[:space:]]+$')
  );

grant insert (reading_status, custom_reading_tags, synopsis_url),
      update (reading_status, custom_reading_tags, synopsis_url)
  on public.tiershelf_queue to authenticated;

create or replace function public.tiershelf_limit_next_up()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reading_status is distinct from 'next-up' then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(238473, pg_catalog.hashtext(new.user_id::text));
  if (select count(*) from public.tiershelf_queue q
      where q.user_id = new.user_id and q.reading_status = 'next-up' and q.id <> new.id) >= 3 then
    raise exception 'Next up already has three books' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tiershelf_limit_next_up on public.tiershelf_queue;
create trigger tiershelf_limit_next_up
  before insert or update of reading_status on public.tiershelf_queue
  for each row execute function public.tiershelf_limit_next_up();

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
    'queue_position', to_jsonb(q)->'queue_position', 'reading_tags', to_jsonb(q)->'reading_tags', 'extra_pokemon_ids', q.extra_pokemon_ids,
    'reading_status', q.reading_status, 'custom_reading_tags', q.custom_reading_tags,
    'synopsis_url', q.synopsis_url
  ) order by q.created_at, q.id), '[]'::jsonb)
  into questlog
  from public.tiershelf_queue q where q.user_id = owner_id;

  return jsonb_build_object('shelf', shelf, 'questlog', questlog);
end;
$$;

notify pgrst, 'reload schema';
commit;
