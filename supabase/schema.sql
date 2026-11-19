begin;

-- GitHub account Dymon18, identified by its stable numeric GitHub user ID.
create or replace function public.tiershelf_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.identities
    where user_id = (select auth.uid())
      and provider = 'github'
      and provider_id = '133081786'
  );
$$;
revoke all on function public.tiershelf_is_owner() from public, anon;
grant execute on function public.tiershelf_is_owner() to authenticated;

create table if not exists public.tiershelf_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  media_type text not null check (media_type in ('movie', 'book', 'anime')),
  grade text not null check (grade in ('S', 'A', 'B', 'C', 'D', 'E', 'F')),
  created_at timestamptz not null default now()
);

create index if not exists tiershelf_entries_owner_created_idx
  on public.tiershelf_entries (user_id, created_at, id);
alter table public.tiershelf_entries enable row level security;
revoke all privileges on public.tiershelf_entries from public, anon, authenticated;
grant select, delete on public.tiershelf_entries to authenticated;
grant insert (title, media_type, grade), update (title, media_type, grade)
  on public.tiershelf_entries to authenticated;

drop policy if exists "Dymon manages own titles" on public.tiershelf_entries;
create policy "Dymon manages own titles" on public.tiershelf_entries
  for all to authenticated
  using ((select public.tiershelf_is_owner()) and user_id = (select auth.uid()))
  with check ((select public.tiershelf_is_owner()) and user_id = (select auth.uid()));

commit;
