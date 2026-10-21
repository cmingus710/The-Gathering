-- Membership approval alerts · Record migration 20261101000300 on the hosted project.
--
-- Hosted already has every object from
-- supabase/migrations/20261101000300_membership_approval_alerts.sql (it was
-- applied while the migration was still numbered 20261101000100, a version
-- that hosted had already recorded for notification_panel, so no history row
-- was written). This script creates, replaces, and grants NOTHING. It checks
-- that the objects match a fresh build of the repository exactly (function
-- bodies by md5), then adds the one missing history row.
--
-- Run once in the SQL editor:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
-- If anything differs it stops with "Nothing was changed: …"; send that
-- message to the developer. A second run stops the same way.
begin;

do $check$
declare
  expected constant text[][] := array[
    ['community.has_due_work()', '099e17be4adfd93946ee95425731363d'],
    ['public.community_job(p_op text, p_payload text, p_ts bigint, p_sig text)', '81bda823353189ecee0b9ab25b11d9ba'],
    ['membership.enqueue_approval_alert(p_profile uuid, p_source text, p_test boolean)', '6790e16c98151f33f8a18b791993bced'],
    ['membership.has_due_alerts()', 'db6188c705a419d69fb8a375e54d327f'],
    ['membership.on_auth_user_verified()', 'e3a6dcc4ba38391e14359e2c11d62009'],
    ['membership.op_alert_claim(v jsonb)', '452d5bffc9c7bfbefe2808bc8ec20cf9'],
    ['membership.op_alert_result(v jsonb)', 'ce9295afc361bfdb26a92ec6a6b7cad7'],
    ['membership.require_settings_manager()', '8b5063c190972289498e06687ae51a67'],
    ['public.membership_alert_add_recipient(p_email text)', 'c346b49b47ab36ce474939891aceecea'],
    ['public.membership_alert_admin()', 'f2cb0651ec4dfb12e19356e2779d6831'],
    ['public.membership_alert_remove_recipient(p_id uuid)', '96726cdbaf5d04bd362fd0f309db4911'],
    ['public.membership_alert_set_enabled(p_enabled boolean)', 'b4b64c6eddda1a32f63a04e35ed32db3']
  ];
  i integer;
  v_md5 text;
  v_missing text := '';
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101000300') then
    raise exception 'Nothing was changed: 20261101000300 is already recorded.';
  end if;
  if to_regnamespace('membership') is null then
    raise exception 'Nothing was changed: the membership schema is missing. Run 2026-11-01-apply-membership-alerts.sql instead.';
  end if;

  for i in 1 .. array_length(expected, 1) loop
    select md5(p.prosrc) into v_md5
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = expected[i][1];
    if v_md5 is distinct from expected[i][2] then
      v_missing := v_missing || ' ' || expected[i][1] || case when v_md5 is null then ' (missing)' else ' (differs)' end || ';';
    end if;
  end loop;

  if to_regclass('membership.alert_settings') is null or to_regclass('membership.alert_recipients') is null
     or to_regclass('membership.approval_alerts') is null or to_regclass('membership.alert_deliveries') is null then
    v_missing := v_missing || ' a membership table;';
  elsif not exists (select 1 from membership.alert_settings where id) then
    v_missing := v_missing || ' the settings row;';
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'auth.users'::regclass and t.tgenabled <> 'D'
         and t.tgname in ('on_auth_user_verified_alert', 'on_auth_user_verified_alert_update')) <> 2 then
    v_missing := v_missing || ' the auth.users triggers;';
  end if;
  if has_schema_privilege('anon', 'membership', 'usage') or has_schema_privilege('authenticated', 'membership', 'usage')
     or has_function_privilege('anon', 'public.membership_alert_admin()', 'execute')
     or not has_function_privilege('authenticated', 'public.membership_alert_admin()', 'execute')
     or not has_function_privilege('anon', 'public.community_job(text, text, bigint, text)', 'execute') then
    v_missing := v_missing || ' grants;';
  end if;

  if v_missing <> '' then
    raise exception 'Nothing was changed: these differ from the repository:%', v_missing;
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261101000300', 'membership_approval_alerts', 'membership-alerts');

commit;
