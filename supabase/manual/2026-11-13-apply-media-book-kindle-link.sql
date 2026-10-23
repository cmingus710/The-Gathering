-- Kindle book URL beside Audible · Apply migration
-- 20261113000100_media_book_kindle_link to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/phase-13/reading-kindle-audible.md, "Kindle
-- book URL beside Audible"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: widens the media.book_details.kindle_url check (Amazon's other
-- country stores and a.co short links; every value allowed before is still
-- allowed, so no row is rewritten, and adding the check re-validates the
-- existing rows) and adds public.media_admin_book_details_patch(uuid, jsonb),
-- granted to `authenticated` only. No other function, table, or grant changes.
--
-- It copies supabase/migrations/20261113000100_media_book_kindle_link.sql
-- verbatim and records it under its repository version (created_by =
-- media-book-kindle-link). All or nothing: one transaction; out of order or
-- a second run stops at the preflight with "Nothing was changed".
-- It needs the Phase 13 church reading step (20261031000400).
begin;

do $preflight$
begin
  if to_regclass('media.book_details') is null or to_regprocedure('public.media_admin_book_details_save(uuid, text, date, date, uuid)') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000400') then
    raise exception 'Nothing was changed: the church reading step (20261031000400) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261113000100')
     or to_regprocedure('public.media_admin_book_details_patch(uuid, jsonb)') is not null then
    raise exception 'Nothing was changed: 20261113000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261113000100_media_book_kindle_link.sql
-- =========================================================================
-- Church reading · Kindle book URL beside the Audible link (additive).
--
-- The Kindle link (media.book_details.kindle_url, Phase 13) moves in the
-- editor to sit beside the Audible link in the book's main form. Saving that
-- form must change only the link, never the reading dates or related lesson
-- (which keep their own "Reading details" form), so:
--
--   * public.media_admin_book_details_patch(item, p jsonb): updates only the
--     keys present in p (kindle_url, reading_starts_on, reading_ends_on,
--     related_lesson_id). Same permission (content.edit), validation, and
--     audit action as media_admin_book_details_save; an unchanged save writes
--     nothing and logs nothing. The audit says what changed, never the URL.
--   * The kindle_url check now also accepts Amazon's other country stores and
--     a.co short links. Still HTTPS only, exact hosts (the host must be
--     followed by "/"), no spaces, quotes or angle brackets, 500 characters.
--     Every value the old check allowed is still allowed, so no row is
--     rewritten. The app validates the full link (product page or short-link
--     path) before saving; this is the database's backstop.
--
-- media_admin_book_details_save (20261031000400) is unchanged and still works.
-- Nothing is embedded and no book text is stored: these are links out.

alter table media.book_details drop constraint book_details_kindle_url_check;
alter table media.book_details add constraint book_details_kindle_url_check check (
  kindle_url ~ '^https://(((www|smile)\.)?amazon\.(com|ca|com\.mx|com\.br|co\.uk|ie|de|fr|it|es|nl|se|pl|com\.be|com\.tr|ae|sa|eg|in|co\.jp|sg|com\.au)|read\.amazon\.(com|co\.uk|ca|com\.au|de|fr|it|es|in|co\.jp)|a\.co)/'
  and char_length(kindle_url) <= 500
  and kindle_url !~ '[[:space:]<>"]');

create function public.media_admin_book_details_patch(p_item uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  d media.book_details;
  v_url text;
  v_starts date;
  v_ends date;
  v_lesson uuid;
begin
  if not exists (select 1 from media.items where id = p_item and kind = 'book') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'That request wasn''t valid.' using errcode = '22023';
  end if;
  select * into d from media.book_details where item_id = p_item for update;
  v_url := case when p ? 'kindle_url' then nullif(btrim(coalesce(p ->> 'kindle_url', '')), '') else d.kindle_url end;
  v_starts := case when p ? 'reading_starts_on' then nullif(p ->> 'reading_starts_on', '')::date else d.reading_starts_on end;
  v_ends := case when p ? 'reading_ends_on' then nullif(p ->> 'reading_ends_on', '')::date else d.reading_ends_on end;
  v_lesson := case when p ? 'related_lesson_id' then nullif(p ->> 'related_lesson_id', '')::uuid else d.related_lesson_id end;
  if p ? 'related_lesson_id' and v_lesson is not null and not exists (select 1 from media.items where id = v_lesson and kind = 'lesson') then
    raise exception 'Choose a Sunday lesson.' using errcode = '22023';
  end if;
  if v_starts is not null and v_ends is not null and v_ends < v_starts then
    raise exception 'The reading end date is before the start date.' using errcode = '22023';
  end if;
  if (v_url, v_starts, v_ends, v_lesson) is not distinct from (d.kindle_url, d.reading_starts_on, d.reading_ends_on, d.related_lesson_id) then
    return;
  end if;
  begin
    insert into media.book_details (item_id, kindle_url, reading_starts_on, reading_ends_on, related_lesson_id, updated_by, updated_at)
    values (p_item, v_url, v_starts, v_ends, v_lesson, v_uid, now())
    on conflict (item_id) do update set kindle_url = excluded.kindle_url, reading_starts_on = excluded.reading_starts_on,
      reading_ends_on = excluded.reading_ends_on, related_lesson_id = excluded.related_lesson_id, updated_by = v_uid, updated_at = now();
  exception when check_violation then
    raise exception 'Use an https:// Amazon or Kindle link (for example https://www.amazon.com/dp/… or https://a.co/d/…).' using errcode = '22023';
  end;
  perform media.audit('media.book_details_saved', 'media_item', p_item,
                      jsonb_build_object('kindle', v_url is not null, 'kindle_changed', v_url is distinct from d.kindle_url,
                                         'dates', v_starts is not null or v_ends is not null,
                                         'related_lesson', v_lesson is not null));
end;
$$;

revoke all on function public.media_admin_book_details_patch(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.media_admin_book_details_patch(uuid, jsonb) to authenticated;

-- Expected afterwards: the new function is callable by signed-in users only,
-- and the Phase 13 functions keep their access.
do $check$
declare
  f text;
begin
  foreach f in array array['public.media_admin_book_details_patch(uuid, jsonb)', 'public.media_admin_book_details_save(uuid, text, date, date, uuid)',
                           'public.media_admin_book_details(uuid)', 'public.media_book_extras(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'Nothing was changed: % would be callable without signing in. Send this message to the developer.', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'Nothing was changed: signed-in members would lose access to %. Send this message to the developer.', f;
    end if;
  end loop;
  if has_function_privilege('service_role', 'public.media_admin_book_details_patch(uuid, jsonb)', 'execute') then
    raise exception 'Nothing was changed: the new function would be granted to service_role. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261113000100', 'media_book_kindle_link', 'media-book-kindle-link');

commit;
