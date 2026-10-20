-- Hosted Supabase loads pg-safeupdate for API sessions, which rejects an
-- UPDATE without a WHERE clause. Both settings tables hold one row (primary
-- key id = true), so the two save functions updated it without one and failed
-- there ("UPDATE requires a WHERE clause"). Same functions, now with
-- "where id". create or replace keeps their owners, grants, and signatures.
-- tests/db/safeupdate.test.ts guards every app function against this.

create or replace function public.finance_settings_save(
  p_min_cents integer, p_max_cents integer, p_ack text, p_org_name text, p_org_address text,
  p_tax_id text, p_wording text, p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := giving.require('finance.manage');
  o giving.settings;
  n giving.settings;
  v_fields text[];
begin
  select * into o from giving.settings;
  update giving.settings
     set min_amount_cents = p_min_cents,
         max_amount_cents = p_max_cents,
         acknowledgment_message = btrim(p_ack),
         statement_org_name = nullif(btrim(p_org_name), ''),
         statement_org_address = nullif(btrim(p_org_address), ''),
         statement_tax_id = nullif(btrim(p_tax_id), ''),
         statement_wording = nullif(btrim(p_wording), ''),
         statement_approved = coalesce(p_approved, false),
         updated_by = v_actor
   where id
  returning * into n;
  select coalesce(array_agg(x.key order by x.key), '{}') into v_fields
    from jsonb_each(to_jsonb(n)) x join jsonb_each(to_jsonb(o)) y using (key)
   where x.value is distinct from y.value and x.key not in ('updated_at', 'updated_by');
  if cardinality(v_fields) > 0 then
    perform giving.audit('finance.settings_updated', 'giving_settings', null, jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
exception when check_violation then
  raise exception 'Check the amounts: the minimum must be at least $1.00 and below the maximum, and statements can only be approved once the organization name and wording are filled in.'
    using errcode = '22023';
end;
$$;

create or replace function public.events_admin_settings_save(p_public_feed boolean, p_default_reminders integer[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  update events.settings
     set public_feed_enabled = coalesce(p_public_feed, false),
         default_reminder_minutes = coalesce(p_default_reminders, default_reminder_minutes),
         updated_at = now()
   where id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'event.settings_updated', 'event_settings', 'events',
          jsonb_build_object('public_feed_enabled', coalesce(p_public_feed, false)));
end;
$$;
