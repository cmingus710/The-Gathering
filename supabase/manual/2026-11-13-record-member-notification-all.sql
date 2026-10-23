-- Member notification "All" overrides · Record migration
-- 20261113000100_member_notification_all on the hosted project.
--
-- The migration's schema is already on hosted: it was run in the SQL editor
-- without a history row. A read-only check on 2026-10-23 found both columns on
-- community.member_settings (boolean, not null, default false; no member has
-- either on), community.delivery_pref applying them under the church channel
-- settings, the two member functions executable by authenticated and not
-- anon, delivery_pref not executable by clients, anon-executable public
-- functions still 34, and no function granted to PUBLIC. This only adds the
-- history row, so the repository and hosted history agree. It changes no
-- schema and no data.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
begin;

do $preflight$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'community' and table_name = 'member_settings' and column_name = 'push_all')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'community' and table_name = 'member_settings' and column_name = 'email_all')
     or to_regprocedure('public.community_my_channel_all()') is null
     or to_regprocedure('public.community_set_channel_all(boolean, boolean)') is null then
    raise exception 'Nothing was changed: the migration''s objects are missing. Run supabase/migrations/20261113000100_member_notification_all.sql first.';
  end if;
  if pg_get_functiondef('community.delivery_pref'::regproc) not like '%s.push_all%' then
    raise exception 'Nothing was changed: community.delivery_pref doesn''t apply the member overrides yet. Rerun the migration.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261113000100') then
    raise exception 'Nothing was changed: 20261113000100 is already recorded.';
  end if;
end
$preflight$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261113000100', 'member_notification_all', 'member-notification-all');

commit;
