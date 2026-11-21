begin;
set local lock_timeout = '3s';

create table if not exists public.tiershelf_category_renames (
  user_id uuid not null references auth.users (id) on delete cascade,
  media_type text not null check (media_type in ('book', 'movie', 'anime', 'game')),
  previous_key text not null,
  label text not null check (char_length(label) between 1 and 48),
  primary key (user_id, media_type, previous_key)
);
alter table public.tiershelf_category_renames enable row level security;
revoke all on public.tiershelf_category_renames from public, anon, authenticated;
grant select on public.tiershelf_category_renames to authenticated;

drop policy if exists "Dymon reads own category names" on public.tiershelf_category_renames;
create policy "Dymon reads own category names" on public.tiershelf_category_renames
  for select to authenticated
  using ((select public.tiershelf_is_owner()) and user_id = (select auth.uid()));

-- Normalize old names when a title is saved from an editor opened before a rename.
create or replace function public.tiershelf_apply_category_renames()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tiershelf_category_renames r
    where r.user_id = new.user_id and r.media_type = new.media_type
  ) then
    return new;
  end if;

  select coalesce(pg_catalog.array_agg(kept.label order by kept.position), '{}'::text[])
    into new.categories
  from (
    select distinct on (pg_catalog.lower(resolved.label)) resolved.label, resolved.position
    from (
      select coalesce(r.label, tags.name) as label, tags.position
      from pg_catalog.unnest(new.categories) with ordinality as tags(name, position)
      left join public.tiershelf_category_renames r
        on r.user_id = new.user_id and r.media_type = new.media_type
        and r.previous_key = pg_catalog.lower(pg_catalog.btrim(tags.name))
    ) resolved
    order by pg_catalog.lower(resolved.label), resolved.position
  ) kept;
  return new;
end;
$$;
revoke all on function public.tiershelf_apply_category_renames() from public, anon, authenticated;

drop trigger if exists tiershelf_normalize_categories on public.tiershelf_entries;
create trigger tiershelf_normalize_categories before insert or update of categories, media_type on public.tiershelf_entries
  for each row execute function public.tiershelf_apply_category_renames();

create or replace function public.tiershelf_rename_category(
  category_type text, existing_name text, new_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_name text := pg_catalog.btrim(existing_name);
  target_name text := pg_catalog.btrim(pg_catalog.regexp_replace(new_name, '[[:space:]]+', ' ', 'g'));
  old_key text := pg_catalog.lower(current_name);
  new_key text := pg_catalog.lower(target_name);
  current_label text;
  affected integer;
begin
  if owner_id is null or not public.tiershelf_is_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if category_type is null or category_type not in ('book', 'movie', 'anime', 'game')
    or old_key is null or pg_catalog.char_length(old_key) = 0
    or target_name is null or pg_catalog.char_length(target_name) not between 1 and 48 then
    raise exception 'Enter a category name from 1 to 48 characters' using errcode = '22023';
  end if;

  -- Serialize renames with other writes to titles, including saves from old tabs.
  lock table public.tiershelf_entries in share row exclusive mode;

  select r.label into current_label from public.tiershelf_category_renames r
    where r.user_id = owner_id and r.media_type = category_type and r.previous_key = old_key;
  if found and pg_catalog.lower(current_label) <> old_key then
    raise exception 'This category has already been renamed. Reopen the category editor.' using errcode = '40001';
  end if;

  if new_key <> old_key and (
    exists (
      select 1 from public.tiershelf_category_renames r
      where r.user_id = owner_id and r.media_type = category_type
        and (r.previous_key = new_key or pg_catalog.lower(r.label) = new_key)
        and pg_catalog.lower(r.label) <> old_key
    )
    or exists (
      select 1 from public.tiershelf_entries e, pg_catalog.unnest(e.categories) as tags(name)
      where e.user_id = owner_id and e.media_type = category_type
        and pg_catalog.lower(pg_catalog.btrim(tags.name)) = new_key
    )
  ) then
    raise exception 'That category name is already in use' using errcode = '23505';
  end if;

  update public.tiershelf_category_renames r set label = target_name
    where r.user_id = owner_id and r.media_type = category_type and pg_catalog.lower(r.label) = old_key;
  insert into public.tiershelf_category_renames(user_id, media_type, previous_key, label)
    values (owner_id, category_type, old_key, target_name)
    on conflict (user_id, media_type, previous_key) do update set label = excluded.label;

  -- Route affected titles through the same normalization used for ordinary edits.
  update public.tiershelf_entries e set categories = e.categories
    where e.user_id = owner_id and e.media_type = category_type
      and exists (
        select 1 from pg_catalog.unnest(e.categories) as tags(name)
        join public.tiershelf_category_renames r
          on r.user_id = owner_id and r.media_type = category_type and r.label = target_name
          and r.previous_key = pg_catalog.lower(pg_catalog.btrim(tags.name))
      );
  get diagnostics affected = row_count;

  return pg_catalog.jsonb_build_object('affected', affected, 'aliases', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'media_type', r.media_type, 'previous_key', r.previous_key, 'label', r.label
    )), '[]'::jsonb)
    from public.tiershelf_category_renames r where r.user_id = owner_id and r.media_type = category_type
  ));
end;
$$;

revoke all on function public.tiershelf_rename_category(text, text, text) from public, anon, authenticated;
grant execute on function public.tiershelf_rename_category(text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
