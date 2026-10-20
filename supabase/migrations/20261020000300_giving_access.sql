-- Phase 3 · Giving: read and administration functions.
--
-- * giving_public_config(): active funds and amount limits (anyone; no amounts given by others).
-- * my_giving*(): the signed-in account's own gifts, in any membership state.
-- * finance_*(): finance users only. Each function checks an explicit
--   finance.* capability; capabilities are re-evaluated on every call, so
--   revoking a finance role takes effect immediately.
-- Finance actions are audited by action and target id only (no amounts,
-- names, notes, or emails in the audit log).

create function giving.require(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.has_capability(p_capability) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

create function giving.church_tz()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select timezone from public.church_settings limit 1), 'America/Chicago');
$$;

create function giving.donor_label(p giving.payments)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select coalesce(nullif(btrim(pr.full_name), ''), pr.email) from public.profiles pr where pr.id = p.profile_id),
    nullif(btrim(p.donor_name), ''),
    case when p.source = 'stripe' then 'Guest' else 'Unidentified donor' end);
$$;

create function giving.refunded_cents(p_payment uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::integer from giving.refunds where payment_id = p_payment and status = 'succeeded';
$$;

-- ---------------------------------------------------------------------------
-- Public
-- ---------------------------------------------------------------------------
create function public.giving_public_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'min_amount_cents', s.min_amount_cents,
    'max_amount_cents', s.max_amount_cents,
    'funds', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'description', f.description) order by f.sort_order, f.name)
      from giving.funds f where f.active), '[]'::jsonb))
  from giving.settings s;
$$;

-- ---------------------------------------------------------------------------
-- Members: own records only
-- ---------------------------------------------------------------------------
create function giving.payment_json(p giving.payments, p_finance boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'source', p.source,
    'status', p.status,
    'amount_cents', p.amount_cents,
    'currency', p.currency,
    'fund_id', p.fund_id,
    'fund_name', p.fund_name,
    'frequency', p.frequency,
    'date', coalesce(p.received_at, p.created_at),
    'received_on', p.received_on,
    'commitment_id', p.commitment_id,
    'refunded_cents', giving.refunded_cents(p.id),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'amount_cents', r.amount_cents, 'status', r.status,
                                          'date', coalesce(r.refunded_at, r.created_at)) order by r.created_at)
      from giving.refunds r where r.payment_id = p.id), '[]'::jsonb),
    'disputed', exists (select 1 from giving.disputes d where d.payment_id = p.id and d.status not in ('won', 'prevented', 'warning_closed')),
    'acknowledged', exists (select 1 from giving.email_outbox e where e.payment_id = p.id and e.kind = 'acknowledgment' and e.status = 'sent'),
    'livemode', p.livemode
  ) || case when p_finance then jsonb_build_object(
    'profile_id', p.profile_id,
    'donor', giving.donor_label(p),
    'donor_email', coalesce((select email from public.profiles where id = p.profile_id), p.donor_email),
    'fee_cents', p.fee_cents,
    'net_cents', p.net_cents,
    'fee_status', p.fee_status,
    'check_reference', p.check_reference,
    'internal_note', p.internal_note,
    'failure_code', p.failure_code,
    'replaces_payment_id', p.replaces_payment_id,
    'replaced_by', (select x.id from giving.payments x where x.replaces_payment_id = p.id limit 1),
    'reversed_at', p.reversed_at,
    'reversal_reason', p.reversal_reason,
    'stripe_payment_intent_id', p.stripe_payment_intent_id,
    'stripe_charge_id', p.stripe_charge_id,
    'stripe_invoice_id', p.stripe_invoice_id,
    'claimed_at', p.claimed_at,
    'created_at', p.created_at,
    'disputes', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'amount_cents', d.amount_cents, 'status', d.status, 'reason', d.reason,
                                          'opened_at', d.opened_at, 'closed_at', d.closed_at) order by d.created_at)
      from giving.disputes d where d.payment_id = p.id), '[]'::jsonb)
  ) else '{}'::jsonb end;
$$;

create function giving.commitment_json(c giving.commitments, p_finance boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'amount_cents', c.amount_cents, 'currency', c.currency, 'fund_name', c.fund_name, 'frequency', c.frequency,
    'status', c.status, 'next_payment_at', case when c.status in ('active', 'trialing', 'past_due') and not c.cancel_at_period_end then c.next_payment_at end,
    'cancel_at_period_end', c.cancel_at_period_end, 'canceled_at', c.canceled_at, 'created_at', c.created_at,
    'payments_count', (select count(*) from giving.payments p where p.commitment_id = c.id and p.status = 'succeeded')
  ) || case when p_finance then jsonb_build_object(
    'profile_id', c.profile_id,
    'donor', coalesce((select coalesce(nullif(btrim(pr.full_name), ''), pr.email) from public.profiles pr where pr.id = c.profile_id),
                      nullif(btrim(c.donor_name), ''), 'Guest'),
    'stripe_subscription_id', c.stripe_subscription_id
  ) else '{}'::jsonb end;
$$;

create function public.my_giving()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_tz text := giving.church_tz();
begin
  if v_me is null then
    raise exception 'Sign in to see your giving.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'payments', coalesce((
      select jsonb_agg(giving.payment_json(p, false) order by coalesce(p.received_at, p.created_at) desc)
      from giving.payments p
      where p.profile_id = v_me and p.status in ('succeeded', 'pending', 'failed')), '[]'::jsonb),
    'commitments', coalesce((
      select jsonb_agg(giving.commitment_json(c, false) order by c.created_at desc)
      from giving.commitments c where c.profile_id = v_me and c.status not in ('incomplete', 'incomplete_expired')), '[]'::jsonb),
    'years', coalesce((
      select jsonb_agg(y order by y desc) from (
        select distinct extract(year from (p.received_at at time zone v_tz))::integer y
        from giving.payments p where p.profile_id = v_me and p.status = 'succeeded') ys), '[]'::jsonb),
    'statement_ready', (select statement_approved from giving.settings)
  );
end;
$$;

create function public.my_giving_payment(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select giving.payment_json(p, false)
         || jsonb_build_object('acknowledgment_message', (select acknowledgment_message from giving.settings))
  from giving.payments p
  where p.id = p_id and p.profile_id = (select auth.uid()) and (select auth.uid()) is not null
    and p.status in ('succeeded', 'pending', 'failed');
$$;

-- Annual statement data. Year boundaries use the church time zone. Only
-- received (succeeded, not reversed) gifts count; refunds and lost disputes
-- in the year appear as adjustments.
create function giving.statement_data(p_profile uuid, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := giving.church_tz();
  v_start timestamptz := make_timestamptz(p_year, 1, 1, 0, 0, 0, giving.church_tz());
  v_end timestamptz := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, giving.church_tz());
  s giving.settings;
  v_items jsonb;
  v_adjustments jsonb;
  v_gross bigint;
  v_adjust bigint;
begin
  if p_year < 2000 or p_year > 2100 then
    raise exception 'Choose a valid year.' using errcode = '22023';
  end if;
  select * into s from giving.settings;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(p.received_at at time zone v_tz, 'YYYY-MM-DD'), 'fund_name', p.fund_name,
           'method', case p.source when 'stripe' then 'Online' when 'cash' then 'Cash' else 'Check' end,
           'amount_cents', p.amount_cents) order by p.received_at), '[]'::jsonb),
         coalesce(sum(p.amount_cents), 0)
    into v_items, v_gross
    from giving.payments p
   where p.profile_id = p_profile and p.status = 'succeeded' and not p.livemode
     and p.received_at >= v_start and p.received_at < v_end;

  select coalesce(jsonb_agg(a.j order by a.d), '[]'::jsonb), coalesce(sum(a.amount), 0)
    into v_adjustments, v_adjust
    from (
      select r.refunded_at d, r.amount_cents amount,
             jsonb_build_object('date', to_char(r.refunded_at at time zone v_tz, 'YYYY-MM-DD'), 'fund_name', p.fund_name,
                                'description', 'Refund', 'amount_cents', -r.amount_cents) j
        from giving.refunds r join giving.payments p on p.id = r.payment_id
       where p.profile_id = p_profile and r.status = 'succeeded' and r.refunded_at >= v_start and r.refunded_at < v_end
      union all
      select d.closed_at, d.amount_cents,
             jsonb_build_object('date', to_char(d.closed_at at time zone v_tz, 'YYYY-MM-DD'), 'fund_name', p.fund_name,
                                'description', 'Payment reversed (dispute)', 'amount_cents', -d.amount_cents)
        from giving.disputes d join giving.payments p on p.id = d.payment_id
       where p.profile_id = p_profile and d.status = 'lost' and d.closed_at >= v_start and d.closed_at < v_end
    ) a;

  return jsonb_build_object(
    'year', p_year,
    'timezone', v_tz,
    'donor_name', (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = p_profile),
    'donor_email', (select email from public.profiles where id = p_profile),
    'items', v_items,
    'adjustments', v_adjustments,
    'gross_cents', v_gross,
    'adjustments_cents', -v_adjust,
    'net_cents', v_gross - v_adjust,
    'church_name', (select church_name from public.church_settings limit 1),
    'org_name', s.statement_org_name,
    'org_address', s.statement_org_address,
    'tax_id', s.statement_tax_id,
    'wording', s.statement_wording,
    'approved', s.statement_approved
  );
end;
$$;

create function public.my_giving_statement(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to download your statement.' using errcode = '42501';
  end if;
  return giving.statement_data((select auth.uid()), p_year);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finance: read
-- ---------------------------------------------------------------------------
create function public.finance_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform giving.require('finance.view');
  with received as (
    select * from giving.payments p
     where p.status = 'succeeded' and not p.livemode and p.received_at >= p_from and p.received_at < p_to
  )
  select jsonb_build_object(
    'gross_cents', coalesce((select sum(amount_cents) from received), 0),
    'gift_count', (select count(*) from received),
    'fees_cents', coalesce((select sum(fee_cents) from received where fee_status = 'known'), 0),
    'fees_pending_count', (select count(*) from received where source = 'stripe' and fee_status in ('pending', 'unavailable')),
    'refunded_cents', coalesce((select sum(r.amount_cents) from giving.refunds r join giving.payments p on p.id = r.payment_id
                                where r.status = 'succeeded' and not p.livemode and r.refunded_at >= p_from and r.refunded_at < p_to), 0),
    'disputed_open_cents', coalesce((select sum(d.amount_cents) from giving.disputes d join giving.payments p on p.id = d.payment_id
                                     where d.closed_at is null and not p.livemode), 0),
    'disputed_lost_cents', coalesce((select sum(d.amount_cents) from giving.disputes d join giving.payments p on p.id = d.payment_id
                                     where d.status = 'lost' and not p.livemode and d.closed_at >= p_from and d.closed_at < p_to), 0),
    'pending_cents', coalesce((select sum(amount_cents) from giving.payments
                               where status = 'pending' and not livemode and created_at >= p_from and created_at < p_to), 0),
    'pending_count', (select count(*) from giving.payments where status = 'pending' and not livemode and created_at >= p_from and created_at < p_to),
    'by_fund', coalesce((select jsonb_agg(jsonb_build_object('fund_name', fund_name, 'gross_cents', total, 'count', n) order by total desc)
                         from (select fund_name, sum(amount_cents) total, count(*) n from received group by fund_name) f), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'gross_cents', total, 'count', n))
                           from (select source, sum(amount_cents) total, count(*) n from received group by source) s), '[]'::jsonb),
    'active_commitments', (select count(*) from giving.commitments where status in ('active', 'past_due', 'trialing') and not livemode)
  ) into v_out;
  return v_out || jsonb_build_object(
    'net_cents', (v_out ->> 'gross_cents')::bigint - (v_out ->> 'fees_cents')::bigint
                 - (v_out ->> 'refunded_cents')::bigint - (v_out ->> 'disputed_lost_cents')::bigint);
end;
$$;

create function giving.contribution_rows(p_filters jsonb)
returns setof giving.payments
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from giving.payments p
   where not p.livemode
     and (nullif(p_filters ->> 'from', '') is null or coalesce(p.received_at, p.created_at) >= (p_filters ->> 'from')::timestamptz)
     and (nullif(p_filters ->> 'to', '') is null or coalesce(p.received_at, p.created_at) < (p_filters ->> 'to')::timestamptz)
     and (nullif(p_filters ->> 'fund_id', '') is null or p.fund_id = (p_filters ->> 'fund_id')::uuid)
     and (nullif(p_filters ->> 'source', '') is null or p.source::text = p_filters ->> 'source')
     and (nullif(p_filters ->> 'status', '') is null or p.status::text = p_filters ->> 'status')
     and (nullif(p_filters ->> 'profile_id', '') is null or p.profile_id = (p_filters ->> 'profile_id')::uuid)
     and (nullif(btrim(p_filters ->> 'q'), '') is null
          or p.donor_name ilike '%' || replace(replace(replace(btrim(p_filters ->> 'q'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or p.donor_email ilike '%' || replace(replace(replace(btrim(p_filters ->> 'q'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or exists (select 1 from public.profiles pr where pr.id = p.profile_id and (
               pr.full_name ilike '%' || replace(replace(replace(btrim(p_filters ->> 'q'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
               or pr.email ilike '%' || replace(replace(replace(btrim(p_filters ->> 'q'), '\', '\\'), '%', '\%'), '_', '\_') || '%')))
   order by coalesce(p.received_at, p.created_at) desc, p.id;
$$;

create function public.finance_contributions(p_filters jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((p_filters ->> 'limit')::integer, 50), 1), 200);
  v_offset integer := greatest(coalesce((p_filters ->> 'offset')::integer, 0), 0);
begin
  perform giving.require('finance.view');
  return jsonb_build_object(
    'total', (select count(*) from giving.contribution_rows(p_filters)),
    'rows', coalesce((
      select jsonb_agg(giving.payment_json(r, true))
      from (select * from giving.contribution_rows(p_filters) limit v_limit offset v_offset) r), '[]'::jsonb));
end;
$$;

create function public.finance_contribution(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p giving.payments;
begin
  perform giving.require('finance.view');
  select * into p from giving.payments where id = p_id;
  if not found then
    return null;
  end if;
  return giving.payment_json(p, true) || jsonb_build_object(
    'commitment', (select giving.commitment_json(c, true) from giving.commitments c where c.id = p.commitment_id),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'status', e.status, 'attempts', e.attempts,
                                                           'sent_at', e.sent_at, 'last_error', e.last_error) order by e.created_at)
                        from giving.email_outbox e where e.payment_id = p.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at,
                                                            'actor', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = a.actor_id))
                                          order by a.created_at)
                         from public.audit_log a where a.target_type = 'payment' and a.target_id = p.id::text), '[]'::jsonb));
end;
$$;

create function public.finance_commitments(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform giving.require('finance.view');
  return coalesce((
    select jsonb_agg(giving.commitment_json(c, true) order by c.created_at desc)
    from giving.commitments c
    where not c.livemode
      and (nullif(p_status, '') is null
           or (p_status = 'active' and c.status in ('active', 'trialing', 'past_due'))
           or (p_status = 'ended' and c.status in ('canceled', 'unpaid', 'incomplete_expired'))
           or c.status = p_status)), '[]'::jsonb);
end;
$$;

create function public.finance_funds()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform giving.require('finance.view');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'description', f.description, 'active', f.active,
                                        'sort_order', f.sort_order,
                                        'gift_count', (select count(*) from giving.payments p where p.fund_id = f.id and p.status = 'succeeded'))
                     order by f.active desc, f.sort_order, f.name)
    from giving.funds f), '[]'::jsonb);
end;
$$;

create function public.finance_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform giving.require('finance.view');
  return (select to_jsonb(s) - 'id' - 'updated_by' from giving.settings s);
end;
$$;

create function public.finance_donor_search(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pattern text;
begin
  perform giving.require('finance.view');
  if nullif(btrim(p_query), '') is null then
    return '[]'::jsonb;
  end if;
  v_pattern := '%' || replace(replace(replace(left(btrim(p_query), 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(nullif(btrim(full_name), ''), email), 'email', email, 'status', membership_status))
    from (select * from public.profiles
           where full_name ilike v_pattern or preferred_name ilike v_pattern or email ilike v_pattern
           order by lower(full_name) limit 20) x), '[]'::jsonb);
end;
$$;

create function public.finance_statement_data(p_profile uuid, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform giving.require('finance.view');
  return giving.statement_data(p_profile, p_year);
end;
$$;

create function public.finance_emails(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform giving.require('finance.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'status', e.status, 'attempts', e.attempts,
                                        'last_error', e.last_error, 'created_at', e.created_at, 'sent_at', e.sent_at,
                                        'payment_id', e.payment_id, 'to', e.to_email) order by e.created_at desc)
    from (select * from giving.email_outbox
           where nullif(p_status, '') is null or status = p_status
           order by created_at desc limit 200) e), '[]'::jsonb);
end;
$$;

create function public.finance_events(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform giving.require('finance.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'status', e.status, 'attempts', e.attempts,
                                        'received_at', e.first_received_at, 'processed_at', e.processed_at, 'last_error', e.last_error)
                     order by e.first_received_at desc)
    from (select * from giving.stripe_events
           where nullif(p_status, '') is null or status = p_status
           order by first_received_at desc limit 200) e), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finance: write
-- ---------------------------------------------------------------------------
create function giving.manual_received_at(p_date date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  -- Noon in the church time zone, so the gift falls on the recorded date.
  select make_timestamptz(extract(year from p_date)::integer, extract(month from p_date)::integer,
                          extract(day from p_date)::integer, 12, 0, 0, giving.church_tz());
$$;

create function giving.insert_manual(
  p_actor uuid, p_token uuid, p_profile uuid, p_donor_name text, p_received_on date, p_amount integer,
  p_fund uuid, p_method text, p_check_ref text, p_note text, p_replaces uuid
)
returns giving.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  p giving.payments;
  f giving.funds;
begin
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then
    raise exception 'Enter an amount between $0.01 and $1,000,000.00.' using errcode = '22023';
  end if;
  if p_received_on is null or p_received_on > (now() at time zone giving.church_tz())::date or p_received_on < date '2000-01-01' then
    raise exception 'Enter the date the gift was received (not in the future).' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'check') then
    raise exception 'Choose cash or check.' using errcode = '22023';
  end if;
  select * into f from giving.funds where id = p_fund;
  if not found then
    raise exception 'Choose a fund.' using errcode = '22023';
  end if;
  if p_profile is not null and not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'Donor not found.' using errcode = 'P0002';
  end if;

  insert into giving.payments (
    source, status, profile_id, donor_name, fund_id, fund_name, amount_cents, received_on, received_at,
    check_reference, internal_note, recorded_by, manual_token, replaces_payment_id, fee_status
  )
  values (
    p_method::giving.payment_source, 'succeeded', p_profile, nullif(btrim(p_donor_name), ''), f.id, f.name, p_amount,
    p_received_on, giving.manual_received_at(p_received_on),
    case when p_method = 'check' then nullif(btrim(p_check_ref), '') end, nullif(btrim(p_note), ''),
    p_actor, p_token, p_replaces, 'not_applicable'
  )
  returning * into p;
  return p;
end;
$$;

-- Duplicate submissions (same form token) return the original record.
create function public.finance_record_manual(
  p_token uuid, p_profile uuid, p_donor_name text, p_received_on date, p_amount_cents integer,
  p_fund uuid, p_method text, p_check_reference text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := giving.require('finance.record');
  p giving.payments;
begin
  perform pg_advisory_xact_lock(hashtext('the-gathering:manual-gift:' || p_token::text));
  select * into p from giving.payments where manual_token = p_token;
  if found then
    return jsonb_build_object('payment_id', p.id, 'duplicate', true);
  end if;
  p := giving.insert_manual(v_actor, p_token, p_profile, p_donor_name, p_received_on, p_amount_cents, p_fund,
                            p_method, p_check_reference, p_note, null);
  perform giving.audit('finance.manual_recorded', 'payment', p.id::text, jsonb_build_object('method', p_method));
  return jsonb_build_object('payment_id', p.id, 'duplicate', false);
end;
$$;

create function public.finance_reverse_payment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := giving.require('finance.record');
  p giving.payments;
begin
  select * into p from giving.payments where id = p_id for update;
  if not found then
    raise exception 'Gift not found.' using errcode = 'P0002';
  end if;
  if p.source = 'stripe' then
    raise exception 'Online gifts are adjusted with a refund, not a reversal.' using errcode = '22023';
  end if;
  if p.status = 'reversed' then
    raise exception 'This gift has already been reversed.' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Enter a reason for the reversal.' using errcode = '22023';
  end if;
  update giving.payments
     set status = 'reversed', reversed_at = now(), reversed_by = v_actor, reversal_reason = left(btrim(p_reason), 300)
   where id = p_id;
  perform giving.audit('finance.manual_reversed', 'payment', p_id::text);
end;
$$;

-- Correction = reverse the original and record a replacement linked to it.
create function public.finance_correct_manual(
  p_id uuid, p_token uuid, p_profile uuid, p_donor_name text, p_received_on date, p_amount_cents integer,
  p_fund uuid, p_method text, p_check_reference text, p_note text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := giving.require('finance.record');
  o giving.payments;
  p giving.payments;
begin
  perform pg_advisory_xact_lock(hashtext('the-gathering:manual-gift:' || p_token::text));
  select * into p from giving.payments where manual_token = p_token;
  if found then
    return jsonb_build_object('payment_id', p.id, 'duplicate', true);
  end if;
  select * into o from giving.payments where id = p_id for update;
  if not found or o.source = 'stripe' then
    raise exception 'Only cash and check gifts can be corrected here.' using errcode = '22023';
  end if;
  if o.status = 'reversed' then
    raise exception 'This gift was already reversed or corrected.' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Enter a reason for the correction.' using errcode = '22023';
  end if;
  update giving.payments
     set status = 'reversed', reversed_at = now(), reversed_by = v_actor, reversal_reason = left('Corrected: ' || btrim(p_reason), 300)
   where id = p_id;
  p := giving.insert_manual(v_actor, p_token, p_profile, p_donor_name, p_received_on, p_amount_cents, p_fund,
                            p_method, p_check_reference, p_note, p_id);
  perform giving.audit('finance.manual_corrected', 'payment', p_id::text, jsonb_build_object('replacement', p.id));
  perform giving.audit('finance.manual_recorded', 'payment', p.id::text, jsonb_build_object('method', p_method, 'replaces', p_id));
  return jsonb_build_object('payment_id', p.id, 'duplicate', false);
end;
$$;

-- Links a manual gift or a guest gift to a member (or removes the link).
create function public.finance_associate_donor(p_payment uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p giving.payments;
begin
  perform giving.require('finance.record');
  select * into p from giving.payments where id = p_payment for update;
  if not found then
    raise exception 'Gift not found.' using errcode = 'P0002';
  end if;
  if p_profile is not null and not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'Donor not found.' using errcode = 'P0002';
  end if;
  if p.source = 'stripe' and p.intent_id is not null
     and exists (select 1 from giving.intents i where i.id = p.intent_id and i.profile_id is not null) then
    raise exception 'This online gift was made while signed in and stays with that account.' using errcode = '22023';
  end if;
  update giving.payments set profile_id = p_profile where id = p_payment;
  if p.commitment_id is not null then
    update giving.commitments set profile_id = p_profile where id = p.commitment_id;
    update giving.payments set profile_id = p_profile where commitment_id = p.commitment_id;
  end if;
  perform giving.audit('finance.donor_associated', 'payment', p_payment::text, jsonb_build_object('linked', p_profile is not null));
end;
$$;

create function public.finance_fund_save(p_id uuid, p_name text, p_description text, p_active boolean, p_sort integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform giving.require('finance.manage');
  if nullif(btrim(p_name), '') is null then
    raise exception 'Enter a fund name.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into giving.funds (name, description, active, sort_order)
    values (btrim(p_name), nullif(btrim(p_description), ''), coalesce(p_active, true), coalesce(p_sort, 0))
    returning id into v_id;
    perform giving.audit('finance.fund_created', 'fund', v_id::text);
  else
    update giving.funds
       set name = btrim(p_name), description = nullif(btrim(p_description), ''), active = coalesce(p_active, active),
           sort_order = coalesce(p_sort, sort_order)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Fund not found.' using errcode = 'P0002';
    end if;
    perform giving.audit('finance.fund_updated', 'fund', v_id::text);
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'A fund with that name already exists.' using errcode = '22023';
end;
$$;

create function public.finance_settings_save(
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

create function public.finance_email_retry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform giving.require('finance.manage');
  update giving.email_outbox set status = 'pending', attempts = 0, last_error = null
   where id = p_id and status in ('failed', 'suppressed');
  if not found then
    raise exception 'That email can''t be retried.' using errcode = '22023';
  end if;
  perform giving.audit('finance.email_retried', 'email', p_id::text);
end;
$$;

-- Checks permission and the refundable balance before the server asks Stripe
-- for a refund. The refund itself is recorded from Stripe's confirmation.
create function public.finance_refund_check(p_payment uuid, p_amount_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p giving.payments;
  v_remaining integer;
begin
  perform giving.require('finance.refund');
  select * into p from giving.payments where id = p_payment;
  if not found or p.source <> 'stripe' or p.status <> 'succeeded' then
    raise exception 'Only received online gifts can be refunded.' using errcode = '22023';
  end if;
  v_remaining := p.amount_cents - giving.refunded_cents(p.id)
                 - coalesce((select sum(amount_cents) from giving.refunds where payment_id = p.id and status = 'pending'), 0)::integer;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_remaining then
    raise exception 'The refund must be between $0.01 and the remaining %.', to_char(v_remaining / 100.0, 'FM$999,990.00')
      using errcode = '22023';
  end if;
  perform giving.audit('finance.refund_requested', 'payment', p.id::text);
  return jsonb_build_object('payment_intent_id', p.stripe_payment_intent_id, 'charge_id', p.stripe_charge_id, 'remaining_cents', v_remaining);
end;
$$;

-- CSV export rows (finance.export); the export itself is audited.
create function public.finance_export(p_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform giving.require('finance.export');
  select coalesce(jsonb_agg(giving.payment_json(r, true)), '[]'::jsonb) into v_rows
    from (select * from giving.contribution_rows(p_filters) limit 20000) r;
  perform giving.audit('finance.exported', 'payments', null, jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema giving from public, anon, authenticated, service_role;

revoke execute on function public.giving_public_config() from public, service_role;
grant execute on function public.giving_public_config() to anon, authenticated;

revoke execute on function
  public.my_giving(),
  public.my_giving_payment(uuid),
  public.my_giving_statement(integer),
  public.finance_summary(timestamptz, timestamptz),
  public.finance_contributions(jsonb),
  public.finance_contribution(uuid),
  public.finance_commitments(text),
  public.finance_funds(),
  public.finance_settings(),
  public.finance_donor_search(text),
  public.finance_statement_data(uuid, integer),
  public.finance_emails(text),
  public.finance_events(text),
  public.finance_record_manual(uuid, uuid, text, date, integer, uuid, text, text, text),
  public.finance_reverse_payment(uuid, text),
  public.finance_correct_manual(uuid, uuid, uuid, text, date, integer, uuid, text, text, text, text),
  public.finance_associate_donor(uuid, uuid),
  public.finance_fund_save(uuid, text, text, boolean, integer),
  public.finance_settings_save(integer, integer, text, text, text, text, text, boolean),
  public.finance_email_retry(uuid),
  public.finance_refund_check(uuid, integer),
  public.finance_export(jsonb)
from public, anon, service_role;

grant execute on function
  public.my_giving(),
  public.my_giving_payment(uuid),
  public.my_giving_statement(integer),
  public.finance_summary(timestamptz, timestamptz),
  public.finance_contributions(jsonb),
  public.finance_contribution(uuid),
  public.finance_commitments(text),
  public.finance_funds(),
  public.finance_settings(),
  public.finance_donor_search(text),
  public.finance_statement_data(uuid, integer),
  public.finance_emails(text),
  public.finance_events(text),
  public.finance_record_manual(uuid, uuid, text, date, integer, uuid, text, text, text),
  public.finance_reverse_payment(uuid, text),
  public.finance_correct_manual(uuid, uuid, uuid, text, date, integer, uuid, text, text, text, text),
  public.finance_associate_donor(uuid, uuid),
  public.finance_fund_save(uuid, text, text, boolean, integer),
  public.finance_settings_save(integer, integer, text, text, text, text, text, boolean),
  public.finance_email_retry(uuid),
  public.finance_refund_check(uuid, integer),
  public.finance_export(jsonb)
to authenticated;
