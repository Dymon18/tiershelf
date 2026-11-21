begin;

-- The original unnamed check can have a different name depending on the installed migrations.
do $$
declare
  previous_check name;
begin
  select conname into strict previous_check
  from pg_catalog.pg_constraint
  where conrelid = 'public.tiershelf_queue'::regclass and contype = 'c'
    and pg_catalog.pg_get_constraintdef(oid) like '%reading_status%'
    and pg_catalog.pg_get_constraintdef(oid) like '%waiting-on-library%'
    and pg_catalog.pg_get_constraintdef(oid) like '%request-needed%';

  execute pg_catalog.format('alter table public.tiershelf_queue drop constraint %I', previous_check);
end
$$;

alter table public.tiershelf_queue
  add constraint tiershelf_queue_reading_status_check check (
    reading_status is null or (media_type = 'book' and source = 'recommended'
      and reading_status in ('in-progress', 'next-up', 'holding', 'waiting-on-library', 'request-needed'))
  );

notify pgrst, 'reload schema';
commit;
