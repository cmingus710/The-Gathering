-- Read-only digest of everything Phase 10 adds or changes, to compare the
-- hosted project with a fresh build from supabase/migrations. Covers the
-- youth schema, the youth bucket and its policies, the youth event audience,
-- the community notification objects Phase 10 replaces, the adult-only
-- shared checks it redefines, the learning-tool membership checks, triggers
-- it adds on earlier tables, and the new capabilities and roles. Run as
-- postgres.
with parts as (
  select 'column' cat, table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') v
    from information_schema.columns
   where table_schema = 'youth'
      or (table_schema = 'community' and table_name = 'notifications' and column_name like 'youth\_%')
  union all select 'constraint', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint
   where connamespace = 'youth'::regnamespace
      or conrelid in ('community.notifications'::regclass, 'community.notification_prefs'::regclass, 'public.profiles'::regclass)
  union all select 'index', schemaname || '.' || indexdef from pg_indexes
   where schemaname = 'youth' or indexname like 'notifications\_youth\_%'
  union all select 'rls', relnamespace::regnamespace::text || '.' || relname || ':' || relrowsecurity from pg_class
   where relnamespace = 'youth'::regnamespace and relkind = 'r'
  union all select 'type', 'events.audience:' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_enum e where e.enumtypid = 'events.audience'::regtype
  union all select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || p.prosecdef || ':'
                   || coalesce(array_to_string(p.proconfig, ','), '') || ':' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'youth'
      or (n.nspname = 'public' and (p.proname like 'youth\_%' or p.proname in ('community_my_settings', 'community_set_pref',
          'is_approved_member', 'is_super_admin', 'has_capability', 'user_roles_adult_only', 'profiles_guard_account_kind')))
      or (n.nspname = 'community' and p.proname in ('kind_category', 'notify', 'notification_visible', 'notification_json',
                                                    'notification_email_item', 'op_push_claim', 'tick'))
      or (n.nspname = 'events' and p.proname in ('audience_allows', 'visible_to'))
      or (n.nspname in ('bible', 'memory') and p.proname = 'is_member')
  union all select 'function_grant', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(array_to_string(p.proacl, ','), 'default')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'youth' or (n.nspname = 'public' and p.proname like 'youth\_%')
  union all select 'schema_acl', nspname || ':' || coalesce(array_to_string(nspacl, ','), '') from pg_namespace where nspname = 'youth'
  union all select 'trigger', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal
     and (tgname like '%youth%' or tgrelid::regclass::text like 'youth.%' or tgname in ('user_roles_adult_only', 'profiles_guard_account_kind'))
  union all select 'storage_bucket', id || ':' || public || ':' || coalesce(file_size_limit::text, '') || ':' || coalesce(array_to_string(allowed_mime_types, ','), '')
    from storage.buckets where id = 'youth'
  union all select 'storage_policy', policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname ilike 'youth%'
  union all select 'seed_capability', key || ':' || available || ':' || md5(description) from public.capabilities where key like 'youth.%' or key like 'family.%'
  union all select 'seed_role', key || ':' || assignable || ':' || md5(description) from public.roles
   where key in ('youth_leader', 'youth_ministry_admin', 'family_admin', 'youth_forms_admin', 'youth_event_logistics',
                 'youth_media_reviewer', 'youth_safeguarding', 'youth_policy_admin')
  union all select 'seed_role_capability', role_key || ':' || capability_key from public.role_capabilities
   where capability_key like 'youth.%' or capability_key like 'family.%'
)
select cat, count(*) n, md5(string_agg(v, '|' order by v)) digest from parts group by cat order by cat;
