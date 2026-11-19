begin;

alter table public.tiershelf_entries
  add column if not exists movie_details jsonb
  check (jsonb_typeof(movie_details) = 'object' and length(movie_details::text) <= 3600);

grant insert (movie_details), update (movie_details)
  on public.tiershelf_entries to authenticated;

notify pgrst, 'reload schema';
commit;
