begin;

alter table public.tiershelf_entries
  add column if not exists categories text[] not null default '{}' check (cardinality(categories) <= 30),
  add column if not exists release_year smallint check (release_year between 1 and 9999),
  add column if not exists wikipedia_url text check (char_length(wikipedia_url) <= 2000),
  add column if not exists poster_url text check (char_length(poster_url) <= 2000);

grant insert (categories, release_year, wikipedia_url, poster_url),
      update (categories, release_year, wikipedia_url, poster_url)
  on public.tiershelf_entries to authenticated;

notify pgrst, 'reload schema';
commit;
