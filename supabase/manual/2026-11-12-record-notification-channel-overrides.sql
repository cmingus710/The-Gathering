-- Church notification channel overrides · Record migration
-- 20261112000100_notification_channel_overrides on the hosted project.
--
-- The migration's schema is already on hosted: it was run in the SQL editor
-- without a history row. A read-only check on 2026-10-23 found the policy
-- table (both overrides off, nothing switched off, RLS on), the five delivery
-- functions using the church setting, and the expected grants (anon can't
-- call the settings functions; clients can't reach the table or helpers;
-- anon-executable public functions still 34). This only adds the history
-- row, so the repository and hosted history agree. It changes no schema and
-- no data.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if to_regclass('community.channel_policy') is null
     or to_regprocedure('community.delivery_pref(uuid, text)') is null
     or to_regprocedure('membership.alerts_on()') is null
     or to_regprocedure('public.notification_channels_admin()') is null
     or to_regprocedure('public.notification_channel_set(text, boolean, text[])') is null then
    raise exception 'Nothing was changed: the migration''s objects are missing. Run supabase/migrations/20261112000100_notification_channel_overrides.sql first.';
  end if;
  if pg_get_functiondef('community.notify'::regproc) not like '%community.delivery_pref(%'
     or pg_get_functiondef('membership.op_alert_claim'::regproc) not like '%membership.alerts_on()%' then
    raise exception 'Nothing was changed: the delivery functions don''t use the church setting yet. Rerun the migration.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261112000100') then
    raise exception 'Nothing was changed: 20261112000100 is already recorded.';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261112000100', 'notification_channel_overrides', 'notification-channel-overrides');

commit;
