-- Notification panel: category filters, keyset paging, and "Clear read".
--
-- Additive only. Builds on the Phase 5–10 notification system (same table,
-- access recheck, preferences, outboxes, Realtime signal); nothing about
-- creation, merging, email, push, digests, or retention changes.
--
-- Added:
--   * community.notifications.dismissed_at: set when the recipient clears a
--     READ notification from their own list. The row itself is kept (it is
--     only that member's copy; the source post, request, event, report, and
--     moderation records are never touched) and is still removed by the
--     existing 180-day retention for read notifications. A check keeps
--     unread notifications from being dismissed.
--   * public.community_notification_panel(categories, unread_only, before,
--     before_id, limit): the bell panel's list. Same access recheck as the
--     full page (community.notification_visible), optional category filter,
--     "unread" matching the bell badge (which leaves direct-message notices
--     to the Messages badge), keyset paging on (time, id), the member's
--     effective time zone for Today/Yesterday grouping, and whether any read
--     notification is left to clear.
--   * public.community_notifications_clear_read(): dismisses the caller's
--     read notifications and returns the batch time, so the panel can offer
--     Undo through public.community_notifications_restore(at), which only
--     restores the caller's own rows from that batch.
--
-- Replaced (same signature and grants): public.community_notifications, so
-- the full page no longer lists dismissed notifications.

alter table community.notifications
  add column dismissed_at timestamptz,
  add constraint notifications_dismissed_read check (dismissed_at is null or read_at is not null);

-- The full page's list (20261022000200) with dismissed notifications left out.
create or replace function public.community_notifications(p_before timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_items jsonb;
begin
  select coalesce(jsonb_agg(community.notification_json(x) order by x.updated_at desc, x.id), '[]'::jsonb)
    into v_items
    from (select n.* from community.notifications n
           where n.profile_id = v_uid
             and n.dismissed_at is null
             and (p_before is null or n.updated_at < p_before)
             and community.notification_visible(n)
           order by n.updated_at desc, n.id
           limit v_limit) x;
  return jsonb_build_object('items', v_items, 'has_more', jsonb_array_length(v_items) = v_limit);
end;
$$;

create function public.community_notification_panel(
  p_categories text[] default null,
  p_unread boolean default false,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 15), 1), 30);
  v_items jsonb;
  v_more boolean;
begin
  if p_categories is not null and not (p_categories <@ array['forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care',
                                                             'teaching', 'gallery', 'reading', 'memory', 'youth']) then
    raise exception 'Unknown notification category.' using errcode = '22023';
  end if;
  if p_before_id is not null and p_before is null then
    raise exception 'A page cursor needs its time.' using errcode = '22023';
  end if;
  -- One extra row tells whether there's another page.
  select coalesce(jsonb_agg(community.notification_json(x) order by x.updated_at desc, x.id desc), '[]'::jsonb)
    into v_items
    from (select n.* from community.notifications n
           where n.profile_id = v_uid
             and n.dismissed_at is null
             and (p_before is null
                  or (p_before_id is null and n.updated_at < p_before)
                  or (p_before_id is not null and (n.updated_at, n.id) < (p_before, p_before_id)))
             and (p_categories is null or n.category = any (p_categories))
             and (not coalesce(p_unread, false) or (n.read_at is null and n.kind <> 'message'))
             and community.notification_visible(n)
           order by n.updated_at desc, n.id desc
           limit v_limit + 1) x;
  v_more := jsonb_array_length(v_items) > v_limit;
  if v_more then
    v_items := v_items - v_limit;
  end if;
  return jsonb_build_object(
    'items', v_items,
    'has_more', v_more,
    'timezone', community.member_tz(v_uid),
    'has_read', exists (select 1 from community.notifications n
                         where n.profile_id = v_uid and n.read_at is not null and n.dismissed_at is null
                           and community.notification_visible(n)));
end;
$$;

create function public.community_notifications_clear_read()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_at timestamptz := clock_timestamp();
  v_count integer;
begin
  update community.notifications set dismissed_at = v_at
   where profile_id = v_uid and read_at is not null and dismissed_at is null;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform community.ping(v_uid, 'read');
  end if;
  return jsonb_build_object('cleared', v_count, 'at', v_at);
end;
$$;

create function public.community_notifications_restore(p_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_count integer;
begin
  if p_at is null then
    return 0;
  end if;
  update community.notifications set dismissed_at = null
   where profile_id = v_uid and dismissed_at = p_at;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform community.ping(v_uid, 'read');
  end if;
  return v_count;
end;
$$;

revoke all on function
  public.community_notification_panel(text[], boolean, timestamptz, uuid, integer),
  public.community_notifications_clear_read(), public.community_notifications_restore(timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  public.community_notification_panel(text[], boolean, timestamptz, uuid, integer),
  public.community_notifications_clear_read(), public.community_notifications_restore(timestamptz)
to authenticated;
