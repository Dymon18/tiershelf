begin;
set local lock_timeout = '3s';

-- The original source keeps the recommender and mailbox link when an entry moves.
alter table public.tiershelf_queue
  add column if not exists queue_bucket text check (queue_bucket in ('recommended', 'self')),
  drop constraint tiershelf_queue_reading_status_check,
  add constraint tiershelf_queue_reading_status_check check (
    reading_status is null or (media_type = 'book' and coalesce(queue_bucket, source) = 'recommended'
      and reading_status in ('in-progress', 'next-up', 'holding', 'waiting-on-library', 'request-needed'))
  );

grant update (queue_bucket) on public.tiershelf_queue to authenticated;

create or replace function public.tiershelf_move_queue_entry(
  entry_id uuid, anchor_id uuid, place_after boolean default false
)
returns table (id uuid, queue_position integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  entry_type text;
  entry_bucket text;
  entry_status text;
  ordered_ids uuid[];
  insertion_index integer;
begin
  if owner_id is null or not public.tiershelf_is_owner() then
    raise exception 'Queue access denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(238471, pg_catalog.hashtext(owner_id::text));
  select q.media_type, coalesce(q.queue_bucket, q.source), coalesce(q.reading_status, 'request-needed')
    into entry_type, entry_bucket, entry_status
    from public.tiershelf_queue q where q.id = entry_id and q.user_id = owner_id for update;
  if not found then raise exception 'Queue entry no longer exists'; end if;

  select coalesce(array_agg(q.id order by q.queue_position nulls last, q.created_at, q.id), '{}'::uuid[])
    into ordered_ids
    from public.tiershelf_queue q
    where q.user_id = owner_id and q.media_type = entry_type and q.id <> entry_id
      and coalesce(q.queue_bucket, q.source) = entry_bucket
      and coalesce(q.reading_status, 'request-needed') = entry_status;

  insertion_index := array_position(ordered_ids, anchor_id);
  if insertion_index is null then raise exception 'Drop target moved or no longer exists'; end if;
  if place_after then insertion_index := insertion_index + 1; end if;

  ordered_ids := ordered_ids[1:insertion_index - 1] || array[entry_id] || ordered_ids[insertion_index:];
  return query
    update public.tiershelf_queue q
      set queue_position = ordered.position::integer
      from unnest(ordered_ids) with ordinality as ordered(entry, position)
      where q.id = ordered.entry and q.user_id = owner_id
        and coalesce(q.queue_bucket, q.source) = entry_bucket
        and coalesce(q.reading_status, 'request-needed') = entry_status
      returning q.id, q.queue_position;
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
    'queue_bucket', q.queue_bucket, 'reading_status', q.reading_status, 'custom_reading_tags', q.custom_reading_tags,
    'synopsis_url', q.synopsis_url
  ) order by q.created_at, q.id), '[]'::jsonb)
  into questlog
  from public.tiershelf_queue q where q.user_id = owner_id;

  return jsonb_build_object('shelf', shelf, 'questlog', questlog);
end;
$$;

notify pgrst, 'reload schema';
commit;
