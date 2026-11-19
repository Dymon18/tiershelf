begin;

alter table public.tiershelf_entries
  add column if not exists author text check (char_length(author) <= 200);

grant insert (author), update (author)
  on public.tiershelf_entries to authenticated;

notify pgrst, 'reload schema';
commit;
