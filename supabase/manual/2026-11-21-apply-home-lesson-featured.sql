-- Home page lesson card · Apply migration 20261121000100_home_lesson_featured
-- to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "Home page lesson card"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: new internal media.featured_lesson(uuid, date); media.lessons_page
-- (same output) and public.media_home (same keys plus 'lesson_state') are
-- replaced with the same signatures and grants. No table or policy changes.
--
-- It copies supabase/migrations/20261121000100_home_lesson_featured.sql
-- verbatim and records it under its repository version (created_by =
-- home-lesson-featured). All or nothing: one transaction; out of order or a
-- second run stops at the preflight with "Nothing was changed".
-- It needs the lessons page step (20261120000100).
begin;

do $preflight$
begin
  if to_regprocedure('public.media_home()') is null or to_regprocedure('media.lessons_page(uuid, date, jsonb, integer, integer)') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261120000100') then
    raise exception 'Nothing was changed: the lessons page step (20261120000100) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261121000100')
     or to_regprocedure('media.featured_lesson(uuid, date)') is not null then
    raise exception 'Nothing was changed: 20261121000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261121000100_home_lesson_featured.sql
-- =========================================================================
-- Home page lesson card · same featured lesson as the Sunday lessons page (additive).
--
-- media_home picked the visible lesson with the newest lesson date, so a
-- lesson published early for a Sunday weeks away showed on the home page as
-- "Latest lesson" ahead of next Sunday's. The choice made for the lessons
-- page in 20261120000100 now lives in one function, media.featured_lesson,
-- used by both:
--
--   * the nearest visible lesson dated the church's today or later
--     ("today" on its date, else "upcoming"); with none, the most recent past
--     one ("latest"); undated lessons never; ties by sort_order, then id.
--   * media.lessons_page: unchanged output, now calls media.featured_lesson.
--   * public.media_home: 'lesson' is that lesson, and the new 'lesson_state'
--     says which of the three it is. Every other key is unchanged (bodies
--     copied from 20261025000300).
--
-- Visibility is media.item_visible as before. "Today" is media.church_today()
-- on every call, so the card moves on at the church's local midnight. No
-- table, policy, grant, or existing signature changes.

create function media.featured_lesson(p_viewer uuid, p_today date, out o_id uuid, out o_state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  select i.id into o_id from media.items i
   where i.kind = 'lesson' and i.delivered_on >= p_today and media.item_visible(i, p_viewer)
   order by i.delivered_on, i.sort_order, i.id limit 1;
  if o_id is not null then
    o_state := case when (select i.delivered_on from media.items i where i.id = o_id) = p_today then 'today' else 'upcoming' end;
    return;
  end if;
  select i.id into o_id from media.items i
   where i.kind = 'lesson' and i.delivered_on < p_today and media.item_visible(i, p_viewer)
   order by i.delivered_on desc, i.sort_order, i.id limit 1;
  if o_id is not null then o_state := 'latest'; end if;
end;
$$;

revoke execute on function media.featured_lesson(uuid, date) from public, anon, authenticated, service_role;

create or replace function media.lessons_page(p_viewer uuid, p_today date, p_filters jsonb, p_limit integer, p_offset integer)
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
  v_id uuid;
  v_feat media.items;
  v_state text;
begin
  if not v_filtered then
    select f.o_id, f.o_state into v_id, v_state from media.featured_lesson(p_viewer, p_today) f;
    select i.* into v_feat from media.items i where i.id = v_id;
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

create or replace function public.media_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := media.church_today();
  v_lesson uuid;
  v_lesson_state text;
begin
  select f.o_id, f.o_state into v_lesson, v_lesson_state from media.featured_lesson(v_uid, v_today) f;
  return jsonb_build_object(
    'devotional', (select media.item_card(x, v_uid) from media.items x
                    where x.kind = 'devotional' and x.devotional_on = v_today and media.item_visible(x, v_uid)
                    order by x.sort_order, x.publish_at desc limit 1),
    'lesson', (select media.item_card(x, v_uid) from media.items x where x.id = v_lesson),
    'lesson_state', v_lesson_state,
    'show', (select jsonb_build_object('id', s.id, 'title', s.title, 'kind', s.kind, 'author', s.author,
                                       'artwork_url', s.artwork_url,
                                       'artwork', (select jsonb_build_object('path', a.path, 'variant_path', a.variant_path)
                                                     from media.assets a where a.id = s.artwork_asset_id and a.status = 'ready'
                                                       and (s.audience <> 'public' or a.public_ok or media.is_member(v_uid))))
               from media.shows s where s.featured and media.show_visible(s, v_uid)
               order by s.sort_order, s.title limit 1),
    'assignment', (select media.item_card(x, v_uid) from media.items x
                    where x.kind = 'assignment' and x.starts_on <= v_today and (x.ends_on is null or x.ends_on >= v_today)
                      and media.item_visible(x, v_uid)
                    order by x.starts_on desc limit 1));
end;
$$;

-- Expected afterwards: the grants are unchanged (members call media_home,
-- visitors don't; nobody calls the internal function) and media_home
-- returns the new key.
do $check$
begin
  if has_function_privilege('anon', 'public.media_home()', 'execute')
     or not has_function_privilege('authenticated', 'public.media_home()', 'execute')
     or has_function_privilege('anon', 'media.featured_lesson(uuid, date)', 'execute')
     or has_function_privilege('authenticated', 'media.featured_lesson(uuid, date)', 'execute')
     or has_function_privilege('service_role', 'media.featured_lesson(uuid, date)', 'execute') then
    raise exception 'Nothing was changed: the home lesson grants are not as expected. Send this message to the developer.';
  end if;
  if not (public.media_home() ? 'lesson_state') then
    raise exception 'Nothing was changed: media_home does not return lesson_state. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261121000100', 'home_lesson_featured', 'home-lesson-featured');

commit;
