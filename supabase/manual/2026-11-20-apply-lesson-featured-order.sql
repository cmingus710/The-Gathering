-- Sunday lessons featured lesson and date order · Apply migration
-- 20261120000100_lesson_featured_order to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "Sunday lessons: featured
-- lesson by lesson date"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: new media.church_date_at(timestamptz), media.lessons_page(...),
-- and public.media_lessons(jsonb, integer, integer) (anon and authenticated,
-- like media_items); media.church_today() is redefined through
-- church_date_at with the same result. No table, policy, or existing
-- signature changes; media_items is untouched.
--
-- It copies supabase/migrations/20261120000100_lesson_featured_order.sql
-- verbatim and records it under its repository version (created_by =
-- lesson-featured-order). All or nothing: one transaction; out of order or
-- a second run stops at the preflight with "Nothing was changed".
-- It needs the media content (20261025000300) and grant baseline
-- (20261029000100) steps.
begin;

do $preflight$
begin
  if to_regprocedure('media.item_card(media.items, uuid)') is null or to_regprocedure('media.matches(media.items, jsonb)') is null
     or to_regprocedure('media.church_today()') is null or to_regprocedure('public.media_items(text, jsonb, integer, integer)') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261029000100') then
    raise exception 'Nothing was changed: the grant baseline step (20261029000100) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261120000100')
     or to_regprocedure('public.media_lessons(jsonb, integer, integer)') is not null then
    raise exception 'Nothing was changed: 20261120000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261120000100_lesson_featured_order.sql
-- =========================================================================
-- Sunday lessons · featured lesson by lesson date, list in date order (additive).
--
-- The lessons page featured whichever visible lesson sorted first by
-- media_items (newest lesson date), so a lesson published early for a
-- Sunday weeks away pushed out next Sunday's. Now:
--
--   * Featured: the nearest visible lesson whose lesson date (delivered_on)
--     is the church's today or later ("today" while its day lasts, else
--     "upcoming"); with none, the most recent past one ("latest"). Undated
--     lessons are never featured. Ties on a date: sort_order, then id.
--   * List: every other visible lesson matching the filters, oldest lesson
--     date first, undated last, the same tie-break, so search, filters, and
--     pages never repeat or skip a lesson. The featured lesson is left out of
--     every unfiltered page (it is shown above the list instead).
--   * "Today" is the church's local date (church_settings.timezone), worked
--     out on every call, so the choice moves on by itself at local midnight.
--     Visibility is unchanged: media.item_visible (status, publish time,
--     expiry, audience) decides, as for every other read.
--
-- media.church_date_at(timestamptz) is the date part of media.church_today(),
-- which now uses it (same result). media.lessons_page takes the viewer and
-- the date so tests can pin both; only public.media_lessons is callable, and
-- it always passes the caller and the church's today. media_items is
-- unchanged.

create function media.church_date_at(p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (p_at at time zone coalesce((select timezone from public.church_settings), 'America/Chicago'))::date;
$$;

create or replace function media.church_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select media.church_date_at(now());
$$;

create function media.lessons_page(p_viewer uuid, p_today date, p_filters jsonb, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  -- The featured lesson is chosen only for the unfiltered list.
  v_filtered boolean := exists (select 1 from jsonb_each_text(v_f) e
                                 where e.key in ('q', 'series_id', 'person_id', 'topic_id', 'book', 'from', 'to') and btrim(e.value) <> '');
  v_feat media.items;
  v_state text;
begin
  if not v_filtered then
    select i.* into v_feat from media.items i
     where i.kind = 'lesson' and i.delivered_on >= p_today and media.item_visible(i, p_viewer)
     order by i.delivered_on, i.sort_order, i.id limit 1;
    if v_feat.id is not null then
      v_state := case when v_feat.delivered_on = p_today then 'today' else 'upcoming' end;
    else
      select i.* into v_feat from media.items i
       where i.kind = 'lesson' and i.delivered_on < p_today and media.item_visible(i, p_viewer)
       order by i.delivered_on desc, i.sort_order, i.id limit 1;
      if v_feat.id is not null then v_state := 'latest'; end if;
    end if;
  end if;
  return (
    with f as (
      select i.* from media.items i
       where i.kind = 'lesson' and media.item_visible(i, p_viewer) and media.matches(i, v_f)
         and (v_feat.id is null or i.id <> v_feat.id))
    select jsonb_build_object(
      'today', p_today,
      'featured', case when v_feat.id is not null then media.item_card(v_feat, p_viewer) end,
      'featured_state', v_state,
      'items', coalesce((select jsonb_agg(media.item_card(x, p_viewer) order by x.delivered_on nulls last, x.sort_order, x.id)
                           from (select * from f order by f.delivered_on nulls last, f.sort_order, f.id
                                  limit v_limit offset v_offset) x), '[]'::jsonb),
      'total', (select count(*) from f)));
end;
$$;

create function public.media_lessons(p_filters jsonb, p_limit integer, p_offset integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select media.lessons_page((select auth.uid()), media.church_today(), p_filters, p_limit, p_offset);
$$;

revoke execute on function media.church_date_at(timestamptz), media.lessons_page(uuid, date, jsonb, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.media_lessons(jsonb, integer, integer) from public, service_role;
-- Like media_items: visitors see public lessons; the function applies the
-- caller's audience rules itself.
grant execute on function public.media_lessons(jsonb, integer, integer) to anon, authenticated;

-- Expected afterwards: church_today unchanged in meaning, the page function
-- callable by visitors and members only, the inner one by nobody.
do $check$
begin
  if media.church_today() <> (now() at time zone coalesce((select timezone from public.church_settings), 'America/Chicago'))::date then
    raise exception 'Nothing was changed: media.church_today() changed meaning. Send this message to the developer.';
  end if;
  if not has_function_privilege('anon', 'public.media_lessons(jsonb, integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.media_lessons(jsonb, integer, integer)', 'execute')
     or has_function_privilege('service_role', 'public.media_lessons(jsonb, integer, integer)', 'execute')
     or has_function_privilege('anon', 'media.lessons_page(uuid, date, jsonb, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'media.lessons_page(uuid, date, jsonb, integer, integer)', 'execute') then
    raise exception 'Nothing was changed: the lesson page grants are not as expected. Send this message to the developer.';
  end if;
  if jsonb_typeof(public.media_lessons('{}'::jsonb, 1, 0) -> 'items') <> 'array' then
    raise exception 'Nothing was changed: public.media_lessons did not return a page. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261120000100', 'lesson_featured_order', 'lesson-featured-order');

commit;
