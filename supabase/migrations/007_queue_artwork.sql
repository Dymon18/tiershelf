begin;

alter table public.tiershelf_queue
  add column if not exists artwork_url text
  check (artwork_url is null or (char_length(artwork_url) <= 2000 and artwork_url like 'https://%'));

grant insert (artwork_url), update (artwork_url)
  on public.tiershelf_queue to authenticated;

notify pgrst, 'reload schema';
commit;
