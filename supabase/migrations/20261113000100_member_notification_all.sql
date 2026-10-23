-- Notification settings (each member's own page): "All push notifications"
-- and "All email notifications", one persistent override per channel.
--
--   push_all  → push for every category, including categories added later.
--   email_all → email for every category that has email (not 'events');
--               a category set to Off is emailed right away, and a category
--               on a daily or weekly summary keeps its summary.
-- Both start off for every member. The per-category choices in
-- community.notification_prefs are never changed by the override, so turning
-- it off restores them exactly; settings pages keep reading community.pref.
--
-- Applied in community.delivery_pref (20261112000100), which community.notify,
-- community.email_items and community.op_push_claim already use when queuing
-- and claiming, so the override is enforced server side. Everything else
-- still applies: "In the app" off still hides that category (and so its
-- email and push, as before), mutes and blocks, quiet hours, current access
-- to the content, a registered device for push, and the church-wide channel
-- settings in Church settings, which only ever narrow delivery. Dedupe keys
-- are unchanged, so nothing is sent twice. Provider configuration is
-- unchanged.
--
-- Additive only: two columns with defaults, one replaced private function
-- (same signature and grants) and two new member functions.

alter table community.member_settings
  add column push_all boolean not null default false,
  add column email_all boolean not null default false;

create or replace function community.delivery_pref(p_profile uuid, p_category text)
returns table (in_app boolean, email text, push boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select x.in_app,
         case when not community.channel_allows('email', p_category) then 'off'
              when x.email = 'off' and p_category <> 'events' and coalesce(s.email_all, false) then 'immediate'
              else x.email end,
         (x.push or coalesce(s.push_all, false)) and community.channel_allows('push', p_category)
    from community.pref(p_profile, p_category) x
    left join community.member_settings s on s.profile_id = p_profile;
$$;

create function public.community_my_channel_all()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  return jsonb_build_object(
    'push_all', coalesce((select push_all from community.member_settings where profile_id = v_uid), false),
    'email_all', coalesce((select email_all from community.member_settings where profile_id = v_uid), false));
end;
$$;

-- Null leaves that channel as it is.
create function public.community_set_channel_all(p_push_all boolean, p_email_all boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  insert into community.member_settings (profile_id, push_all, email_all)
  values (v_uid, coalesce(p_push_all, false), coalesce(p_email_all, false))
  on conflict (profile_id) do update
    set push_all = coalesce(p_push_all, community.member_settings.push_all),
        email_all = coalesce(p_email_all, community.member_settings.email_all),
        updated_at = now();
  return public.community_my_channel_all();
end;
$$;

revoke execute on function public.community_my_channel_all(), public.community_set_channel_all(boolean, boolean) from public, anon, service_role;
grant execute on function public.community_my_channel_all(), public.community_set_channel_all(boolean, boolean) to authenticated;
