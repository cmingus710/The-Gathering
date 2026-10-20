-- Read-only digest of everything Phase 9 adds or changes, to compare the
-- hosted project with a fresh build from supabase/migrations. Covers the
-- memory schema, the memory bucket and its policies, the community
-- notification objects Phase 9 replaces, access-loss triggers, the new
-- capabilities and roles, and seeded badges. Run as postgres.
with parts as (
  select 'column' cat, table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') v
    from information_schema.columns
   where table_schema = 'memory'
      or (table_schema = 'community' and table_name = 'notifications' and column_name in ('memory_item_id', 'memory_challenge_id'))
  union all select 'constraint', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint
   where connamespace = 'memory'::regnamespace
      or conrelid in ('community.notifications'::regclass, 'community.notification_prefs'::regclass)
  union all select 'index', schemaname || '.' || indexdef from pg_indexes
   where schemaname = 'memory' or indexname in ('notifications_memory_item_idx', 'notifications_memory_challenge_idx')
  union all select 'rls', relnamespace::regnamespace::text || '.' || relname || ':' || relrowsecurity from pg_class
   where relnamespace = 'memory'::regnamespace and relkind = 'r'
  union all select 'type', t.typname || ':' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'memory'::regnamespace group by t.typname
  union all select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || p.prosecdef || ':'
                   || coalesce(array_to_string(p.proconfig, ','), '') || ':' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'memory'
      or (n.nspname = 'public' and (p.proname like 'memory\_%' or p.proname in ('community_my_settings', 'community_set_pref')))
      or (n.nspname = 'community' and p.proname in ('kind_category', 'notify', 'notification_visible', 'notification_json',
                                                    'notification_email_item', 'op_push_claim', 'tick'))
  union all select 'function_grant', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(array_to_string(p.proacl, ','), 'default')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'memory' or (n.nspname = 'public' and p.proname like 'memory\_%')
  union all select 'schema_acl', nspname || ':' || coalesce(array_to_string(nspacl, ','), '') from pg_namespace where nspname = 'memory'
  union all select 'trigger', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and (tgname like '%memory%' or tgrelid::regclass::text like 'memory.%')
  union all select 'storage_bucket', id || ':' || public || ':' || coalesce(file_size_limit::text, '') || ':' || coalesce(array_to_string(allowed_mime_types, ','), '')
    from storage.buckets where id = 'memory'
  union all select 'storage_policy', policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname ilike 'memory%'
  union all select 'seed_capability', key || ':' || available from public.capabilities where key in ('memory.manage', 'memory.publish')
  union all select 'seed_role', key || ':' || assignable || ':' || md5(description) from public.roles
   where key in ('memory_verse_editor', 'memory_verse_publisher')
  union all select 'seed_role_capability', role_key || ':' || capability_key from public.role_capabilities
   where capability_key in ('memory.manage', 'memory.publish')
  union all select 'seed_badges', key || ':' || name || ':' || md5(description) || ':' || sort_order from memory.badges
)
select cat, count(*) n, md5(string_agg(v, '|' order by v)) digest from parts group by cat order by cat;
