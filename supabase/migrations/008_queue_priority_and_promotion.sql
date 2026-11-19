begin;

alter table public.tiershelf_queue
  add column if not exists queue_position integer check (queue_position > 0);

grant update (queue_position) on public.tiershelf_queue to authenticated;

alter table public.tiershelf_entries
  add column if not exists recommender_pokemon_id integer check (recommender_pokemon_id between 1 and 20000),
  add column if not exists source_queue_id uuid references public.tiershelf_queue (id) on delete set null;

create unique index if not exists tiershelf_entries_source_queue_idx
  on public.tiershelf_entries (source_queue_id) where source_queue_id is not null;

grant insert (recommender_pokemon_id, source_queue_id), update (recommender_pokemon_id)
  on public.tiershelf_entries to authenticated;

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
  entry_source text;
  ordered_ids uuid[];
  insertion_index integer;
begin
  if owner_id is null or not public.tiershelf_is_owner() then
    raise exception 'Queue access denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(238471, pg_catalog.hashtext(owner_id::text));
  select q.media_type, q.source into entry_type, entry_source
    from public.tiershelf_queue q where q.id = entry_id and q.user_id = owner_id for update;
  if not found then raise exception 'Queue entry no longer exists'; end if;

  select coalesce(array_agg(q.id order by q.queue_position nulls last, q.created_at, q.id), '{}'::uuid[])
    into ordered_ids
    from public.tiershelf_queue q
    where q.user_id = owner_id and q.media_type = entry_type and q.source = entry_source and q.id <> entry_id;

  insertion_index := array_position(ordered_ids, anchor_id);
  if insertion_index is null then raise exception 'Drop target moved or no longer exists'; end if;
  if place_after then insertion_index := insertion_index + 1; end if;

  ordered_ids := ordered_ids[1:insertion_index - 1] || array[entry_id] || ordered_ids[insertion_index:];
  return query
    update public.tiershelf_queue q
      set queue_position = ordered.position::integer
      from unnest(ordered_ids) with ordinality as ordered(entry, position)
      where q.id = ordered.entry and q.user_id = owner_id
      returning q.id, q.queue_position;
end;
$$;

revoke all on function public.tiershelf_move_queue_entry(uuid, uuid, boolean) from public, anon;
grant execute on function public.tiershelf_move_queue_entry(uuid, uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
