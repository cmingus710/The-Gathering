-- Phase 11: pin function EXECUTE grants to the reviewed baseline.
--
-- The hosted project's default privileges for role postgres in schema public
-- grant EXECUTE only to postgres, and every migration grants `authenticated`
-- (or `anon`) explicitly. That default was set on the hosted project, not in
-- a migration, so a project built from these files elsewhere (a recovery
-- target, a staging project, `supabase start`) kept the platform default
-- (anon, authenticated, service_role) and ended up with about 160 more
-- functions callable with the publishable key alone, and service_role on
-- most of them. Each function still checks its caller, but this layer is
-- part of the design (docs/architecture.md, "Explicit function grants").
--
-- On the hosted project this migration changes nothing: the default is
-- already in place, exactly these 29 public functions are executable by
-- anon, and only bootstrap_super_admin by service_role (checked read-only on
-- 2026-10-21; see docs/phase-11-release-readiness.md). `authenticated`
-- grants are not touched.

alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;

do $$
declare
  -- Reviewed anonymous entry points: public catalog/feed reads that apply
  -- their own audience rules, signed job and ingest endpoints, and the
  -- storage read checks used by storage policies.
  anon_allowed constant text[] := array[
    'is_approved_member', 'giving_public_config', 'giving_ingest',
    'events_categories', 'events_occurrence', 'can_view_event_image', 'events_list',
    'events_feed_private', 'events_feed_public', 'events_public_feed_enabled', 'events_job',
    'community_job',
    'media_items', 'media_can_read_object', 'media_item', 'media_devotional_day', 'media_series',
    'media_facets', 'media_file', 'media_transcript', 'media_public_artwork', 'media_search',
    'media_job', 'media_shows', 'media_show', 'media_external_episode', 'media_public_feed',
    'media_public_hit', 'media_public_episode_audio'
  ];
  -- Operator script only (scripts/bootstrap-super-admin.mjs).
  service_allowed constant text[] := array['bootstrap_super_admin'];
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'community', 'events', 'giving', 'media', 'prayer', 'bible', 'journal', 'memory', 'youth')
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public', f.sig);
    if not (f.nspname = 'public' and f.proname = any (anon_allowed)) then
      execute format('revoke execute on function %s from anon', f.sig);
    end if;
    if not (f.nspname = 'public' and f.proname = any (service_allowed)) then
      execute format('revoke execute on function %s from service_role', f.sig);
    end if;
  end loop;
end
$$;
