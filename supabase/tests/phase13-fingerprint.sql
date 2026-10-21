-- Read-only digest of the Phase 13 objects (campaigns, forum attachments, lesson
-- workbooks, books reading) and the anon-executable function list, to compare the
-- hosted project with a fresh build from supabase/migrations. Run as postgres.
with parts as (
  select 'column' cat, table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') v
    from information_schema.columns
   where (table_schema, table_name) in (('giving','campaigns'),('community','attachments'),('media','lesson_blocks'),('media','workbook_answers'),('media','workbook_notes'),('media','book_details'),('media','book_progress'))
      or (table_schema = 'giving' and column_name = 'campaign_id')
  union all select 'constraint', conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) from pg_constraint
   where conrelid::regclass::text in ('giving.campaigns','community.attachments','media.lesson_blocks','media.workbook_answers','media.workbook_notes','media.book_details','media.book_progress','journal.entries','giving.payments','giving.intents','giving.commitments')
  union all select 'rls', relnamespace::regnamespace::text||'.'||relname||':'||relrowsecurity from pg_class
   where relkind='r' and relnamespace::regnamespace::text in ('giving','media','community','journal')
  union all select 'table_grant', table_schema||'.'||table_name||':'||grantee||':'||privilege_type from information_schema.role_table_grants
   where table_schema in ('giving','media','community','journal') and grantee in ('anon','authenticated','service_role','PUBLIC')
  union all select 'function', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||p.prosecdef||':'||coalesce(array_to_string(p.proconfig,','),'')||':'||md5(regexp_replace(p.prosrc,'\s+',' ','g'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('giving','media','community','journal')
      or (n.nspname='public' and (p.proname like 'giving%' or p.proname like 'finance%' or p.proname like 'media%' or p.proname like 'community%' or p.proname like 'journal%' or p.proname like 'can_view_campaign%'))
  union all select 'function_grant', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||coalesce(array_to_string(p.proacl,','),'default')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and (p.proname like 'giving%' or p.proname like 'finance%' or p.proname like 'media%' or p.proname like 'community%' or p.proname like 'journal%' or p.proname like 'can_view_campaign%')
  union all select 'trigger', tgrelid::regclass::text||':'||tgname||':'||pg_get_triggerdef(oid) from pg_trigger
   where not tgisinternal and tgrelid::regclass::text in ('giving.campaigns','giving.payments','giving.intents','giving.commitments','community.attachments','community.threads','community.posts','media.lesson_blocks','media.assets','media.workbook_answers')
  union all select 'storage_bucket', id||':'||public||':'||coalesce(file_size_limit::text,'')||':'||coalesce(array_to_string(allowed_mime_types,','),'')
    from storage.buckets where id in ('campaign-images','media','media-uploads')
  union all select 'storage_policy', policyname||':'||cmd||':'||array_to_string(roles,',')||':'||coalesce(regexp_replace(qual,'\s+','','g'),'')||':'||coalesce(regexp_replace(with_check,'\s+','','g'),'')
    from pg_policies where schemaname='storage' and tablename='objects' and (policyname ilike '%campaign%' or policyname ilike 'community attachments%')
  union all select 'anon_exec', n.nspname||'.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','community','events','giving','media','prayer','bible','journal','memory','youth') and has_function_privilege('anon', p.oid, 'execute')
)
select cat, count(*) n, md5(string_agg(v, '|' order by v)) digest from parts group by cat order by cat;
