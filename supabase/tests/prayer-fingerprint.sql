-- Read-only digest of everything Phase 6 adds or changes, to compare the
-- hosted project with a fresh build from supabase/migrations. Covers the
-- prayer schema, the community notification objects Phase 6 replaces, the
-- replaced has_capability(), access-loss triggers, prayer/care capabilities
-- and roles, and seeded settings. Run as postgres.
with parts as (
  select 'column' cat, table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') v
    from information_schema.columns
   where table_schema = 'prayer'
      or (table_schema = 'community' and table_name = 'notifications' and column_name in ('prayer_request_id', 'care_request_id', 'care_opportunity_id'))
  union all select 'constraint', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint
   where connamespace = 'prayer'::regnamespace
      or conrelid in ('community.notifications'::regclass, 'community.notification_prefs'::regclass)
  union all select 'index', schemaname || '.' || indexdef from pg_indexes
   where schemaname = 'prayer' or indexname in ('notifications_prayer_request_idx', 'notifications_care_request_idx', 'notifications_care_opportunity_idx')
  union all select 'rls', relname || ':' || relrowsecurity from pg_class where relnamespace = 'prayer'::regnamespace and relkind = 'r'
  union all select 'type', t.typname || ':' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'prayer'::regnamespace group by t.typname
  union all select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || p.prosecdef || ':'
                   || coalesce(array_to_string(p.proconfig, ','), '') || ':' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'prayer'
      or (n.nspname = 'public' and (p.proname like 'prayer\_%' or p.proname like 'care\_%' or p.proname in ('has_capability', 'community_my_settings', 'community_set_pref')))
      or (n.nspname = 'community' and p.proname in ('kind_category', 'pref', 'notify', 'notification_visible', 'notification_json',
                                                    'notification_email_item', 'email_items', 'op_push_claim', 'tick'))
  union all select 'function_grant', n.nspname || '.' || p.proname || ':' || coalesce(array_to_string(p.proacl, ','), 'default')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'prayer' or (n.nspname = 'public' and (p.proname like 'prayer\_%' or p.proname like 'care\_%' or p.proname = 'has_capability'))
  union all select 'schema_acl', nspname || ':' || coalesce(array_to_string(nspacl, ','), '') from pg_namespace where nspname = 'prayer'
  union all select 'trigger', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and tgname in ('group_members_prayer_access', 'profiles_prayer_access', 'user_roles_prayer_access')
  union all select 'seed_capability', key || ':' || available from public.capabilities where key like 'prayer.%' or key like 'care.%'
  union all select 'seed_role', key || ':' || assignable || ':' || md5(description) from public.roles where key like 'prayer\_%' or key like 'care\_%'
  union all select 'seed_role_capability', role_key || ':' || capability_key from public.role_capabilities where capability_key like 'prayer.%' or capability_key like 'care.%'
  union all select 'seed_settings', retention_enabled || ':' || closed_archive_days || ':' || archived_delete_days || ':' || care_delete_days || ':'
                   || report_evidence_days || ':' || md5(guidance) from prayer.settings
)
select cat, count(*) n, md5(string_agg(v, '|' order by v)) digest from parts group by cat order by cat;
