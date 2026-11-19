begin;

create table if not exists public.tiershelf_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  media_type text not null check (media_type in ('movie', 'book', 'anime')),
  author text check (author is null or (media_type = 'book' and char_length(btrim(author)) between 1 and 200)),
  source text not null check (source in ('recommended', 'self')),
  pokemon_id integer not null check (pokemon_id between 1 and 20000),
  created_at timestamptz not null default now(),
  check (source <> 'self' or pokemon_id = 132)
);

create index if not exists tiershelf_queue_owner_created_idx
  on public.tiershelf_queue (user_id, created_at, id);

alter table public.tiershelf_queue enable row level security;
revoke all privileges on public.tiershelf_queue from public, anon, authenticated;
grant select, delete on public.tiershelf_queue to authenticated;
grant insert (title, media_type, author, source, pokemon_id),
      update (title, media_type, author, source, pokemon_id)
  on public.tiershelf_queue to authenticated;

drop policy if exists "Dymon manages own queue" on public.tiershelf_queue;
create policy "Dymon manages own queue" on public.tiershelf_queue
  for all to authenticated
  using ((select public.tiershelf_is_owner()) and user_id = (select auth.uid()))
  with check ((select public.tiershelf_is_owner()) and user_id = (select auth.uid()));

notify pgrst, 'reload schema';
commit;
