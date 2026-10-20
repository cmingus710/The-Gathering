-- Read-only digest of everything Phase 8 adds or changes, to compare the
-- hosted project with a fresh build from supabase/migrations. Covers the
-- bible and journal schemas, the bible bucket and its policies, the
-- community notification objects Phase 8 replaces, access-loss triggers,
-- the new capabilities and roles, and seeded rows. Run as postgres.
with parts as (
  select 'column' cat, table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') v
    from information_schema.columns
   where table_schema in ('bible', 'journal')
      or (table_schema = 'community' and table_name = 'notifications' and column_name in ('bible_enrollment_id', 'bible_plan_id'))
  union all select 'constraint', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint
   where connamespace in ('bible'::regnamespace, 'journal'::regnamespace)
      or conrelid in ('community.notifications'::regclass, 'community.notification_prefs'::regclass)
  union all select 'index', schemaname || '.' || indexdef from pg_indexes
   where schemaname in ('bible', 'journal') or indexname in ('notifications_bible_enrollment_idx', 'notifications_bible_plan_idx')
  union all select 'rls', relnamespace::regnamespace::text || '.' || relname || ':' || relrowsecurity from pg_class
   where relnamespace in ('bible'::regnamespace, 'journal'::regnamespace) and relkind = 'r'
  union all select 'type', t.typname || ':' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'bible'::regnamespace group by t.typname
  union all select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || p.prosecdef || ':'
                   || coalesce(array_to_string(p.proconfig, ','), '') || ':' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('bible', 'journal')
      or (n.nspname = 'public' and (p.proname like 'bible\_%' or p.proname like 'journal\_%' or p.proname in ('community_my_settings', 'community_set_pref')))
      or (n.nspname = 'community' and p.proname in ('kind_category', 'notify', 'notification_visible', 'notification_json',
                                                    'notification_email_item', 'op_push_claim', 'tick'))
  union all select 'function_grant', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(array_to_string(p.proacl, ','), 'default')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('bible', 'journal') or (n.nspname = 'public' and (p.proname like 'bible\_%' or p.proname like 'journal\_%'))
  union all select 'schema_acl', nspname || ':' || coalesce(array_to_string(nspacl, ','), '') from pg_namespace where nspname in ('bible', 'journal')
  union all select 'trigger', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and (tgname like '%bible%' or tgrelid::regclass::text like 'bible.%' or tgrelid::regclass::text like 'journal.%')
  union all select 'storage_bucket', id || ':' || public || ':' || coalesce(file_size_limit::text, '') || ':' || coalesce(array_to_string(allowed_mime_types, ','), '')
    from storage.buckets where id = 'bible'
  union all select 'storage_policy', policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname ilike 'bible%'
  union all select 'seed_capability', key || ':' || available from public.capabilities where key in ('reading.edit', 'reading.publish', 'bible.manage')
  union all select 'seed_role', key || ':' || assignable || ':' || md5(description) from public.roles
   where key in ('reading_plan_editor', 'reading_plan_publisher', 'bible_source_manager')
  union all select 'seed_role_capability', role_key || ':' || capability_key from public.role_capabilities
   where capability_key in ('reading.edit', 'reading.publish', 'bible.manage')
  union all select 'seed_books', code || ':' || ordinal || ':' || name || ':' || testament || ':' || array_to_string(chapter_verses, ',') from bible.books
  union all select 'seed_settings', md5((to_jsonb(s) - 'updated_at' - 'updated_by' - 'default_translation_id')::text) from bible.settings s
)
select cat, count(*) n, md5(string_agg(v, '|' order by v)) digest from parts group by cat order by cat;
