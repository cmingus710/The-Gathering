-- Read-only digest of everything Phase 7 adds or changes, to compare the
-- hosted project with a fresh build from supabase/migrations. Covers the
-- media schema, its storage buckets and policies, the community
-- notification objects Phase 7 replaces, access-loss triggers, the new
-- capabilities and roles, and seeded settings. Run as postgres.
with parts as (
  select 'column' cat, table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') v
    from information_schema.columns
   where table_schema = 'media'
      or (table_schema = 'community' and table_name = 'notifications' and column_name in ('media_item_id', 'media_album_id'))
  union all select 'constraint', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint
   where connamespace = 'media'::regnamespace
      or conrelid in ('community.notifications'::regclass, 'community.notification_prefs'::regclass)
  union all select 'index', schemaname || '.' || indexdef from pg_indexes
   where schemaname = 'media' or indexname in ('notifications_media_item_idx', 'notifications_media_album_idx')
  union all select 'rls', relname || ':' || relrowsecurity from pg_class where relnamespace = 'media'::regnamespace and relkind = 'r'
  union all select 'type', t.typname || ':' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'media'::regnamespace group by t.typname
  union all select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || p.prosecdef || ':'
                   || coalesce(array_to_string(p.proconfig, ','), '') || ':' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'media'
      or (n.nspname = 'public' and (p.proname like 'media\_%' or p.proname in ('community_my_settings', 'community_set_pref')))
      or (n.nspname = 'community' and p.proname in ('kind_category', 'pref', 'notify', 'notification_visible', 'notification_json',
                                                    'notification_email_item', 'op_push_claim', 'tick', 'has_due_work'))
  union all select 'function_grant', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(array_to_string(p.proacl, ','), 'default')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'media' or (n.nspname = 'public' and p.proname like 'media\_%')
  union all select 'schema_acl', nspname || ':' || coalesce(array_to_string(nspacl, ','), '') from pg_namespace where nspname = 'media'
  union all select 'trigger', tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid)
    from pg_trigger where not tgisinternal and (tgname like '%media%' or tgrelid::regclass::text like 'media.%')
  union all select 'storage_bucket', id || ':' || public || ':' || coalesce(file_size_limit::text, '') || ':' || coalesce(array_to_string(allowed_mime_types, ','), '')
    from storage.buckets where id in ('media', 'media-uploads')
  union all select 'storage_policy', policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname ilike 'media%'
  union all select 'seed_capability', key || ':' || available from public.capabilities
   where key in ('content.edit', 'content.publish', 'media.manage', 'podcasts.manage', 'gallery.moderate')
  union all select 'seed_role', key || ':' || assignable || ':' || md5(description) from public.roles
   where key in ('content_publisher', 'media_manager', 'podcast_manager', 'gallery_moderator')
  union all select 'seed_role_capability', role_key || ':' || capability_key from public.role_capabilities
   where capability_key in ('content.edit', 'content.publish', 'media.manage', 'podcasts.manage', 'gallery.moderate')
  union all select 'seed_settings', md5((to_jsonb(s) - 'updated_at' - 'updated_by')::text) from media.settings s
)
select cat, count(*) n, md5(string_agg(v, '|' order by v)) digest from parts group by cat order by cat;
