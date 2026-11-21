begin;
set local lock_timeout = '3s';

alter table public.tiershelf_entries
  drop constraint if exists tiershelf_entries_media_type_check,
  add constraint tiershelf_entries_media_type_check check (media_type in ('book', 'movie', 'anime', 'game'));

-- PostgreSQL generated a name for the original cross-column book-only check.
do $$
declare
  legacy_check name;
begin
  for legacy_check in
    select conname from pg_catalog.pg_constraint
    where conrelid = 'public.tiershelf_queue'::regclass and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) like '%source_recommendation_id%'
      and pg_catalog.pg_get_constraintdef(oid) like '%media_type%'
  loop
    execute pg_catalog.format('alter table public.tiershelf_queue drop constraint %I', legacy_check);
  end loop;
end;
$$;

alter table public.tiershelf_queue
  drop constraint if exists tiershelf_queue_media_type_check,
  add constraint tiershelf_queue_media_type_check check (media_type in ('book', 'movie', 'anime', 'game')),
  drop constraint if exists tiershelf_queue_source_recommendation_id_check,
  add constraint tiershelf_queue_source_recommendation_id_check
    check (source_recommendation_id is null or source = 'recommended');

alter table public.tiershelf_recommendations
  add column if not exists media_type text not null default 'book'
    check (media_type in ('book', 'movie', 'anime', 'game'));

-- Convert non-book suggestions received while the site was using the legacy RPC.
update public.tiershelf_recommendations
  set media_type = pg_catalog.split_part(author, ':', 3), author = null
  where media_type = 'book'
    and author in ('tiershelf-recommendation:v1:movie', 'tiershelf-recommendation:v1:anime', 'tiershelf-recommendation:v1:game');

-- The existing key, snapshot and book RPC remain valid for open tabs and older clients.
create or replace function public.tiershelf_submit_media_recommendation(
  access_key text, media_kind text, media_title text, recommender_name text,
  media_author text, recommendation_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  title_value text := pg_catalog.btrim(media_title, E' \t\r\n');
  sender_value text := pg_catalog.btrim(recommender_name, E' \t\r\n');
  author_value text := nullif(pg_catalog.btrim(media_author, E' \t\r\n'), '');
  note_value text := nullif(pg_catalog.btrim(recommendation_note, E' \t\r\n'), '');
begin
  if access_key is null or pg_catalog.char_length(access_key) not between 7 and 128 then
    return false;
  end if;

  select k.user_id into owner_id
    from public.tiershelf_viewer_keys k
    where k.key_hash = pg_catalog.sha256(pg_catalog.convert_to(access_key, 'UTF8'))
    for share;
  if not found then return false; end if;

  if media_kind is null or media_kind not in ('book', 'movie', 'anime', 'game')
    or title_value is null or pg_catalog.char_length(title_value) not between 1 and 200
    or sender_value is null or pg_catalog.char_length(sender_value) not between 1 and 100
    or pg_catalog.char_length(author_value) > 200
    or pg_catalog.char_length(note_value) > 1000 then
    raise exception 'Enter a supported media type, title and name within the field limits' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(238472, pg_catalog.hashtext(owner_id::text));
  if (select count(*) from public.tiershelf_recommendations r
      where r.user_id = owner_id and r.created_at > now() - interval '1 minute') >= 12 then
    raise exception 'Try again in a minute' using errcode = 'P0001';
  end if;

  insert into public.tiershelf_recommendations (user_id, media_type, title, sender, author, note)
    values (owner_id, media_kind, title_value, sender_value,
      case when media_kind = 'book' then author_value else null end, note_value);
  return true;
end;
$$;

revoke all on function public.tiershelf_submit_media_recommendation(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.tiershelf_submit_media_recommendation(text, text, text, text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
