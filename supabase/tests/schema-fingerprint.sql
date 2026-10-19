-- Schema fingerprint used to compare a hosted project with a database built
-- from supabase/migrations. Function bodies are compared after removing
-- comments and whitespace, so formatting differences don't count.
-- Read-only. Run in the SQL editor or psql; diff the output of two databases.
with
norm as (select '[[:space:]]+' as ws),
items(kind, detail) as (
  select 'enum', t.typname || ':' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typnamespace = 'public'::regnamespace group by t.typname
  union all
  select 'column', c.table_name || '.' || c.column_name || ' ' || c.data_type || coalesce('(' || c.udt_name || ')', '')
         || ' null=' || c.is_nullable || ' default=' || coalesce(c.column_default, '-')
  from information_schema.columns c where c.table_schema = 'public'
  union all
  select 'constraint', conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
  from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'index', indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'rls', relname || ' rls=' || relrowsecurity from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
  union all
  select 'policy', schemaname || '.' || tablename || ' "' || policyname || '" ' || cmd || ' to ' || array_to_string(roles, ',')
         || ' using=' || coalesce(regexp_replace(qual, (select ws from norm), '', 'g'), '-')
         || ' check=' || coalesce(regexp_replace(with_check, (select ws from norm), '', 'g'), '-')
  from pg_policies where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')
  union all
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') returns ' || pg_get_function_result(p.oid)
         || ' definer=' || p.prosecdef || ' config=' || coalesce(array_to_string(p.proconfig, ','), '-')
         || ' vol=' || p.provolatile::text
         || ' body_md5=' || md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), (select ws from norm), '', 'g'))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'rls_auto_enable'
  union all
  select 'function_grant', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
         || r.rolname || '=' || has_function_privilege(r.rolname, p.oid, 'execute')
  from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
  where p.pronamespace = 'public'::regnamespace and p.proname <> 'rls_auto_enable'
  union all
  select 'table_grant', table_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  union all
  select 'column_grant', table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.column_privileges
  where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')
    and not exists (select 1 from information_schema.role_table_grants g
                    where g.table_schema = 'public' and g.table_name = column_privileges.table_name
                      and g.grantee = column_privileges.grantee and g.privilege_type = column_privileges.privilege_type)
  union all
  select 'trigger', pg_get_triggerdef(t.oid) from pg_trigger t
  where not t.tgisinternal and (t.tgrelid::regclass::text like 'public.%' or t.tgrelid = 'auth.users'::regclass
        or t.tgrelid::regclass::text in ('profiles', 'user_roles', 'church_settings', 'announcements'))
    and t.tgname not like 'RI_%' and t.tgfoid::regproc::text not like 'storage.%'
    and (select nspname from pg_namespace n join pg_proc f on f.pronamespace = n.oid where f.oid = t.tgfoid) = 'public'
  union all
  select 'comment', c.relname || coalesce('.' || a.attname, '') || ': ' || d.description
  from pg_description d join pg_class c on c.oid = d.objoid
  left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
  where c.relnamespace = 'public'::regnamespace
  union all
  select 'bucket', id || ' public=' || public || ' limit=' || file_size_limit || ' types=' || array_to_string(allowed_mime_types, ',')
  from storage.buckets where id in ('branding', 'announcement-images', 'profile-photos')
  union all
  select 'seed_role', key || ' assignable=' || assignable || ' ' || name from public.roles
  union all
  select 'seed_capability', key || ' available=' || available from public.capabilities
  union all
  select 'seed_role_capability', role_key || '->' || capability_key from public.role_capabilities
  union all
  select 'seed_settings', church_name || ' tz=' || timezone || ' rows=' || (select count(*) from public.church_settings)
  from public.church_settings
)
-- Detail view (uncomment to inspect differences):
-- select kind, detail from items order by kind, detail;
select kind, count(*) as items, md5(string_agg(detail, E'\n' order by detail)) as digest
from items group by kind order by kind;
