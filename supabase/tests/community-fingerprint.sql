-- Read-only digest of everything Phase 5 adds or changes, to compare the
-- hosted project with a fresh build from supabase/migrations. Covers the
-- community schema, the events objects Phase 5 replaces, Realtime and storage
-- policies, community capabilities/roles, and seeded rows. Run as postgres.
with parts as (
  select 'column' cat, table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') v
    from information_schema.columns where table_schema = 'community'
  union all select 'constraint', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'community'::regnamespace
      or (connamespace = 'events'::regnamespace and conname in ('series_group_audience', 'series_group_fk'))
  union all select 'index', schemaname || '.' || indexdef from pg_indexes where schemaname = 'community' or indexname = 'series_group_idx'
  union all select 'rls', relname || ':' || relrowsecurity from pg_class where relnamespace = 'community'::regnamespace and relkind = 'r'
  union all select 'policy', schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':'
                   || coalesce(qual, '') || ':' || coalesce(with_check, '')
    from pg_policies
   where (schemaname = 'storage' and policyname ilike '%group%') or schemaname = 'realtime'
  union all select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || p.prosecdef || ':'
                   || coalesce(array_to_string(p.proconfig, ','), '') || ':' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'community'
      or (n.nspname = 'public' and (p.proname like 'community\_%' or p.proname in ('can_view_group_image', 'can_manage_group_image',
                                                                                  'events_admin_groups', 'events_admin_save', 'events_occurrence')))
      or (n.nspname = 'events' and p.proname in ('group_member', 'can_target_group'))
  union all select 'function_grant', n.nspname || '.' || p.proname || ':' || coalesce(array_to_string(p.proacl, ','), 'default')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'community' or (n.nspname = 'public' and (p.proname like 'community\_%' or p.proname like '%group_image'))
  union all select 'schema_acl', nspname || ':' || coalesce(array_to_string(nspacl, ','), '') from pg_namespace where nspname = 'community'
  union all select 'trigger', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and (tgrelid::regclass::text like 'community.%' or tgname = 'community_event_notifications')
  union all select 'seed_capability', key || ':' || available from public.capabilities where key like 'community.%'
  union all select 'seed_role', key || ':' || assignable || ':' || md5(description) from public.roles where key in ('community_admin', 'community_moderator', 'group_leader')
  union all select 'seed_role_capability', role_key || ':' || capability_key from public.role_capabilities where capability_key like 'community.%'
  union all select 'seed_category', name || ':' || sort_order || ':' || active from community.categories
  union all select 'seed_settings', guidelines_version || ':' || digest_hour || ':' || dm_retention_days || ':' || md5(guidelines) from community.settings
  union all select 'bucket', id || ':' || public || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'group-images'
)
select cat, count(*) n, md5(string_agg(v, '|' order by v)) digest from parts group by cat order by cat;
