begin;

grant delete on public.tiershelf_recommendations to authenticated;

drop policy if exists "Dymon deletes private recommendations" on public.tiershelf_recommendations;
create policy "Dymon deletes private recommendations" on public.tiershelf_recommendations
  for delete to authenticated
  using ((select public.tiershelf_is_owner()) and user_id = (select auth.uid()));

notify pgrst, 'reload schema';
commit;
