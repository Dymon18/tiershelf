begin;

alter table public.tiershelf_entries
  add column if not exists tier_position integer check (tier_position > 0);

grant update (tier_position) on public.tiershelf_entries to authenticated;

create or replace function public.tiershelf_move_entry(
  entry_id uuid, destination text, anchor_id uuid default null, place_after boolean default false
)
returns table (id uuid, grade text, tier_position integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  entry_type text;
  ordered_ids uuid[];
  insertion_index integer;
begin
  if owner_id is null or not public.tiershelf_is_owner() then
    raise exception 'Archive access denied' using errcode = '42501';
  end if;
  if destination is null or destination not in ('S', 'A', 'B', 'C', 'D', 'E', 'F') then
    raise exception 'Invalid tier' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select e.media_type into entry_type
    from public.tiershelf_entries e where e.id = entry_id and e.user_id = owner_id for update;
  if not found then raise exception 'Title no longer exists'; end if;

  select coalesce(array_agg(e.id order by e.tier_position nulls last, e.created_at, e.id), '{}'::uuid[])
    into ordered_ids
    from public.tiershelf_entries e
    where e.user_id = owner_id and e.media_type = entry_type and e.grade = destination and e.id <> entry_id;

  if anchor_id is null then
    insertion_index := cardinality(ordered_ids) + 1;
  else
    insertion_index := array_position(ordered_ids, anchor_id);
    if insertion_index is null then raise exception 'Drop target moved or no longer exists'; end if;
    if place_after then insertion_index := insertion_index + 1; end if;
  end if;

  ordered_ids := ordered_ids[1:insertion_index - 1] || array[entry_id] || ordered_ids[insertion_index:];
  return query
    update public.tiershelf_entries e
      set grade = destination, tier_position = ordered.position::integer
      from unnest(ordered_ids) with ordinality as ordered(entry, position)
      where e.id = ordered.entry and e.user_id = owner_id
      returning e.id, e.grade, e.tier_position;
end;
$$;

revoke all on function public.tiershelf_move_entry(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.tiershelf_move_entry(uuid, text, uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
