-- Prayer Library link catalogues · Record migration
-- 20261130000100_prayer_link_catalog on the hosted project when its SQL was
-- already run without a history row.
--
-- Use this ONLY if the migration's SQL was pasted and run on its own (so the
-- prayer.link_* tables and the public.prayer_link_* functions exist) and
-- 20261130000100 isn't recorded. Otherwise use
-- 2026-11-30-apply-prayer-link-catalog.sql.
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Changes nothing but the history row. All or nothing: the same post-checks
-- as the apply script run first (every table with RLS on and closed to the
-- API roles, every function created with the grants it should have, the
-- internal helpers closed, each one security definer with an empty
-- search_path), and only then is the version recorded
-- (created_by = prayer-link-catalog).
--
-- Unlike the apply script it does NOT require the catalogue to be empty: a
-- settings manager may already have imported the pinned catalogue through
-- Admin → Prayer link catalogues, which is expected and left alone.
begin;

do $preflight$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261130000100') then
    raise exception 'Nothing was changed: 20261130000100 is already recorded.';
  end if;
  if to_regclass('prayer.link_catalogs') is null
     or to_regclass('prayer.link_prayers') is null
     or to_regprocedure('public.prayer_link_catalogs()') is null
     or to_regprocedure('public.prayer_link_import_apply(uuid)') is null then
    raise exception 'Nothing was changed: the link catalogue migration is not (fully) in this database. Use 2026-11-30-apply-prayer-link-catalog.sql.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261115000100') then
    raise exception 'Nothing was changed: the Prayer Library step (20261115000100) is not recorded. Send this message to the developer.';
  end if;
end
$preflight$;

-- =========================================================================
-- Checks: the tables exist with RLS on and no API role can read them, the
-- member and management functions reach `authenticated` and nobody else, the
-- internal helpers stay closed, and every new function is security definer
-- with an empty search_path. Whatever has been imported is left alone.
-- =========================================================================
do $check$
declare
  v_table text;
  v_fn text;
  v_open integer;
begin
  foreach v_table in array array['link_catalogs', 'link_topics', 'link_prayers', 'link_prayer_topics',
                                 'link_imports', 'link_import_topics', 'link_import_rows']
  loop
    if to_regclass('prayer.' || v_table) is null then
      raise exception 'Nothing was changed: prayer.% was not created. Send this message to the developer.', v_table;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('prayer.' || v_table)::regclass) then
      raise exception 'Nothing was changed: row level security is off on prayer.%. Send this message to the developer.', v_table;
    end if;
    if has_table_privilege('anon', 'prayer.' || v_table, 'select')
       or has_table_privilege('authenticated', 'prayer.' || v_table, 'select')
       or has_table_privilege('service_role', 'prayer.' || v_table, 'select') then
      raise exception 'Nothing was changed: an API role can read prayer.%. Send this message to the developer.', v_table;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.prayer_link_catalogs()',
    'public.prayer_link_catalog(uuid)',
    'public.prayer_link_list(uuid, text, uuid, integer, integer)',
    'public.prayer_link_admin_catalogs()',
    'public.prayer_link_admin_catalog(uuid)',
    'public.prayer_link_admin_list(uuid, text, uuid, text, integer, integer)',
    'public.prayer_link_catalog_save(uuid, text, text, integer)',
    'public.prayer_link_catalog_status(uuid, text)',
    'public.prayer_link_set_published(uuid[], boolean)',
    'public.prayer_link_publish_all(uuid, uuid, boolean)',
    'public.prayer_link_topic_archive(uuid, boolean)',
    'public.prayer_link_import_begin(jsonb, jsonb, integer)',
    'public.prayer_link_import_topics(uuid, jsonb)',
    'public.prayer_link_import_rows(uuid, jsonb)',
    'public.prayer_link_import_apply(uuid)',
    'public.prayer_link_import_close(uuid, text, text)']
  loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Nothing was changed: % was not created. Send this message to the developer.', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Nothing was changed: the grants on % are not as expected. Send this message to the developer.', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'prayer.link_count(uuid, uuid)',
    'prayer.link_catalog_json(prayer.link_catalogs, integer)',
    'prayer.link_row_json(prayer.link_prayers)',
    'prayer.link_visible_catalog(uuid)',
    'prayer.link_reindex_catalog(uuid)',
    'prayer.link_catalog_admin_json(prayer.link_catalogs)']
  loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Nothing was changed: % was not created. Send this message to the developer.', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Nothing was changed: the internal helper % is not closed. Send this message to the developer.', v_fn;
    end if;
  end loop;

  select count(*) into v_open
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname like 'prayer_link_%' and n.nspname = 'public'
     and (not p.prosecdef
          or p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c in ('search_path=', 'search_path=""')));
  if v_open > 0 then
    raise exception 'Nothing was changed: % prayer_link_ function(s) are not security definer with an empty search_path. Send this message to the developer.', v_open;
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261130000100', 'prayer_link_catalog', 'prayer-link-catalog');

commit;
