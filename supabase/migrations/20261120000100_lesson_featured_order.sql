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
