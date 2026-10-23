-- Media cover framing · Record migration 20261110000100 on the hosted project.
--
-- Hosted already has every object from
-- supabase/migrations/20261110000100_media_cover_framing.sql. It was applied
-- while the migration was still numbered 20261109000100, a version hosted had
-- already recorded for media_video_kind (#47), so no history row was written.
-- This script creates, replaces, and grants NOTHING. It checks that the
-- objects match a fresh build of the repository exactly (function bodies,
-- constraints, and triggers by md5), then adds the one missing history row.
--
-- Run once in the SQL editor:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
-- If anything differs it stops with "Nothing was changed: …"; send that
-- message to the developer. A second run stops the same way.
begin;

do $check$
declare
  expected constant text[][] := array[
    ['media.clean_framing(p jsonb)', '2b130c75d2ae2d386c46c3cd3af17ae2'],
    ['media.cover_json(i media.items, p_viewer uuid, p_admin boolean)', '1b4d98967fea0950e2cac413d5e644a6'],
    ['media.reset_cover_framing()', 'f84aedcb04f5aeaef0e6ea181370793b'],
    ['public.media_admin_cover_framing_save(p_item uuid, p_series uuid, p_cover uuid, p_framing jsonb)', '5ee9e4e867d2820991267995471dfd46'],
    ['public.media_admin_taxonomy()', '3507f389c0a1c501aa9f491833ba050d'],
    ['public.media_series(p_id uuid)', '01d184446baaa816109257e4032c8f2e']
  ];
  i integer;
  v_md5 text;
  v_missing text := '';
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261110000100') then
    raise exception 'Nothing was changed: 20261110000100 is already recorded.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000200') then
    raise exception 'Nothing was changed: the previous step (20261109000200, media_videos) is not recorded.';
  end if;

  for i in 1 .. array_length(expected, 1) loop
    select md5(p.prosrc) into v_md5
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = expected[i][1];
    if v_md5 is distinct from expected[i][2] then
      v_missing := v_missing || ' ' || expected[i][1] || case when v_md5 is null then ' (missing)' else ' (differs)' end || ';';
    end if;
  end loop;

  if (select count(*) from pg_constraint
       where conname in ('items_cover_framing_check', 'series_cover_framing_check')
         and md5(pg_get_constraintdef(oid)) = '276eceebb7987c9d5182bee715a60f0e') <> 2 then
    v_missing := v_missing || ' the cover_framing check constraints;';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'items_reset_cover_framing' and md5(pg_get_triggerdef(oid)) = 'd821ef2360285523fb3ae8f749f819fb')
     or not exists (select 1 from pg_trigger where tgname = 'series_reset_cover_framing' and md5(pg_get_triggerdef(oid)) = 'fe5e422f8cdac1bc57ae72895397768e') then
    v_missing := v_missing || ' the reset triggers;';
  end if;
  if not has_function_privilege('authenticated', 'public.media_admin_cover_framing_save(uuid, uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.media_admin_cover_framing_save(uuid, uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'media.clean_framing(jsonb)', 'execute') then
    v_missing := v_missing || ' grants;';
  end if;

  if v_missing <> '' then
    raise exception 'Nothing was changed: these differ from the repository:%', v_missing;
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261110000100', 'media_cover_framing', 'media-cover-framing');

commit;
