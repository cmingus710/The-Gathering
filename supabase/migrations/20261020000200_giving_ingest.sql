-- Phase 3 · Giving: the server ingest path.
--
-- public.giving_ingest(op, payload, ts, sig) is the only way to write
-- provider-confirmed payment state. It is callable with the publishable key,
-- but every call must carry an HMAC-SHA256 signature over
-- "<op>.<ts>.<payload>" made with the secret in giving.secrets('ingest'),
-- which only the app server holds (env GIVING_INGEST_SECRET). Requests older
-- than 5 minutes are refused. All operations are idempotent, so a replayed
-- request inside that window cannot create duplicates.
--
-- The server calls these operations only after verifying the Stripe webhook
-- signature, and it always re-reads the object from the Stripe API, so state
-- is taken from Stripe rather than from the browser or the event order.
-- Fund, donor, and frequency always come from the database's own records
-- (the intent created before checkout), never from Stripe metadata alone.

create function giving.audit(p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb, p_actor uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (coalesce(p_actor, (select auth.uid())), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

-- Reference printed in a guest's acknowledgment. Derived from the payment id
-- and the ingest secret, so it is never stored and can't be guessed.
create function giving.claim_code(p_payment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select upper(substr(h, 1, 5) || '-' || substr(h, 6, 5))
  from (
    select encode(extensions.hmac('claim:' || p_payment_id::text, s.value, 'sha256'), 'hex') as h
    from giving.secrets s where s.name = 'ingest'
  ) x;
$$;

create function giving.enqueue_email(
  p_kind text, p_key text, p_to text, p_payment uuid, p_commitment uuid, p_refund uuid, p_recovery_url text, p_livemode boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into giving.email_outbox (kind, dedupe_key, to_email, payment_id, commitment_id, refund_id, recovery_url, livemode)
  select p_kind, p_key, lower(btrim(p_to)), p_payment, p_commitment, p_refund, p_recovery_url, coalesce(p_livemode, false)
  where nullif(btrim(p_to), '') is not null
  on conflict (dedupe_key) do nothing;
$$;

-- Who receives notices for a gift: the member's sign-in email, or the guest's.
create function giving.recipient(p_profile uuid, p_donor_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select nullif(email, '') from public.profiles where id = p_profile), p_donor_email);
$$;

create function giving.fee_fields(p_fee jsonb)
returns table (fee_cents integer, net_cents integer, bt_id text, fee_status text)
language sql
immutable
set search_path = ''
as $$
  select
    case when p_fee ->> 'status' = 'known' then (p_fee ->> 'fee_cents')::integer end,
    case when p_fee ->> 'status' = 'known' then (p_fee ->> 'net_cents')::integer end,
    p_fee ->> 'balance_transaction_id',
    coalesce(p_fee ->> 'status', 'pending');
$$;

-- Applies fee data unless an exact fee is already recorded.
create function giving.apply_fee(p_payment uuid, p_fee jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
begin
  if p_fee is null or jsonb_typeof(p_fee) <> 'object' then
    return;
  end if;
  select * into f from giving.fee_fields(p_fee);
  update giving.payments
     set fee_cents = f.fee_cents,
         net_cents = f.net_cents,
         stripe_balance_transaction_id = coalesce(f.bt_id, stripe_balance_transaction_id),
         fee_status = f.fee_status
   where id = p_payment
     and fee_status <> 'known'
     and f.fee_status in ('known', 'pending', 'unavailable');
end;
$$;

-- Monotonic status: a confirmed payment is never moved back by a late or
-- out-of-order event; a failed payment may still succeed on retry.
create function giving.next_status(p_old giving.payment_status, p_new giving.payment_status)
returns giving.payment_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_old in ('succeeded', 'reversed') then p_old
    when p_old = 'failed' and p_new in ('pending', 'canceled') then p_old
    else p_new
  end;
$$;

create function giving.map_pi_status(p_status text, p_failure text)
returns giving.payment_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'succeeded' then 'succeeded'::giving.payment_status
    when p_status = 'canceled' then 'canceled'::giving.payment_status
    when p_status = 'requires_payment_method' and p_failure is not null then 'failed'::giving.payment_status
    else 'pending'::giving.payment_status
  end;
$$;

create function giving.ts(p_epoch text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when nullif(p_epoch, '') is null then null else to_timestamp(p_epoch::double precision) end;
$$;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create function giving.op_rate_limit(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(secs => greatest(coalesce((v ->> 'window_seconds')::integer, 60), 1));
  v_count integer;
begin
  insert into giving.rate_limits as r (key, window_start, count)
  values (v ->> 'key', now(), 1)
  on conflict (key) do update
    set count = case when r.window_start < now() - v_window then 1 else r.count + 1 end,
        window_start = case when r.window_start < now() - v_window then now() else r.window_start end
  returning count into v_count;
  return jsonb_build_object('allowed', v_count <= coalesce((v ->> 'limit')::integer, 10), 'count', v_count);
end;
$$;

create function giving.op_checkout_prepare(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s giving.settings;
  f giving.funds;
  i giving.intents;
  v_amount integer := (v ->> 'amount_cents')::integer;
  v_freq giving.frequency := (v ->> 'frequency')::giving.frequency;
  v_profile uuid := nullif(v ->> 'profile_id', '')::uuid;
begin
  select * into s from giving.settings;
  if v_amount is null or v_amount < s.min_amount_cents or v_amount > s.max_amount_cents then
    raise exception 'Enter an amount between % and %.', to_char(s.min_amount_cents / 100.0, 'FM$999,990.00'), to_char(s.max_amount_cents / 100.0, 'FM$999,990.00')
      using errcode = '22023';
  end if;
  select * into f from giving.funds where id = (v ->> 'fund_id')::uuid and active;
  if not found then
    raise exception 'That fund is not available. Please choose another.' using errcode = '22023';
  end if;
  if v_profile is not null and not exists (select 1 from public.profiles where id = v_profile) then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  insert into giving.intents (idempotency_key, profile_id, fund_id, amount_cents, frequency)
  values (v ->> 'idempotency_key', v_profile, f.id, v_amount, v_freq)
  on conflict (idempotency_key) do nothing
  returning * into i;

  if i.id is null then
    select * into i from giving.intents where idempotency_key = v ->> 'idempotency_key';
    if i.profile_id is distinct from v_profile or i.fund_id <> f.id or i.amount_cents <> v_amount or i.frequency <> v_freq then
      raise exception 'This form was already submitted with different details. Please reload the page and try again.' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'intent_id', i.id,
    'status', i.status,
    'session_id', i.stripe_checkout_session_id,
    'checkout_url', i.checkout_url,
    'session_expires_at', i.session_expires_at,
    'fund_id', f.id,
    'fund_name', f.name,
    'product_id', f.stripe_test_product_id,
    'amount_cents', i.amount_cents,
    'frequency', i.frequency,
    'customer_id', (select stripe_customer_id from giving.customers where profile_id = v_profile and not livemode),
    'profile_email', (select nullif(email, '') from public.profiles where id = v_profile)
  );
end;
$$;

create function giving.op_checkout_attach(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i giving.intents;
begin
  update giving.intents
     set stripe_checkout_session_id = v ->> 'session_id',
         checkout_url = v ->> 'checkout_url',
         session_expires_at = giving.ts(v ->> 'expires_at')
   where id = (v ->> 'intent_id')::uuid and stripe_checkout_session_id is null and status = 'open'
  returning * into i;
  if i.id is null then
    select * into i from giving.intents where id = (v ->> 'intent_id')::uuid;
  end if;
  return jsonb_build_object('session_id', i.stripe_checkout_session_id, 'checkout_url', i.checkout_url);
end;
$$;

create function giving.op_customer_link(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := (v ->> 'profile_id')::uuid;
  v_live boolean := coalesce((v ->> 'livemode')::boolean, false);
begin
  insert into giving.customers (profile_id, stripe_customer_id, livemode)
  values (v_profile, v ->> 'customer_id', v_live)
  on conflict do nothing;
  return jsonb_build_object('customer_id',
    (select stripe_customer_id from giving.customers where profile_id = v_profile and livemode = v_live));
end;
$$;

create function giving.op_fund_product(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update giving.funds
     set stripe_test_product_id = coalesce(stripe_test_product_id, v ->> 'product_id')
   where id = (v ->> 'fund_id')::uuid;
  return jsonb_build_object('product_id', (select stripe_test_product_id from giving.funds where id = (v ->> 'fund_id')::uuid));
end;
$$;

-- Claims a webhook event for processing. Duplicate deliveries of a processed
-- event are skipped; a concurrent delivery is told to retry later.
create function giving.op_event_begin(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e giving.stripe_events;
  v_live boolean := coalesce((v ->> 'livemode')::boolean, false);
begin
  insert into giving.stripe_events (id, type, livemode, stripe_created, status)
  values (v ->> 'id', v ->> 'type', v_live, giving.ts(v ->> 'created'), 'processing')
  on conflict (id) do nothing
  returning * into e;

  if e.id is null then
    select * into e from giving.stripe_events where id = v ->> 'id' for update;
    if e.status in ('processed', 'ignored') then
      return jsonb_build_object('action', 'skip');
    end if;
    if e.status = 'processing' and e.last_attempt_at > now() - interval '2 minutes' then
      return jsonb_build_object('action', 'busy');
    end if;
    update giving.stripe_events set status = 'processing', attempts = attempts + 1, last_attempt_at = now() where id = e.id;
  end if;

  if v_live and not (select allow_live_mode from giving.settings) then
    update giving.stripe_events set status = 'ignored', processed_at = now(), last_error = 'live mode is not enabled' where id = e.id;
    return jsonb_build_object('action', 'ignore', 'reason', 'live_mode_disabled');
  end if;
  return jsonb_build_object('action', 'process');
end;
$$;

create function giving.op_event_finish(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update giving.stripe_events
     set status = case when v ->> 'status' in ('processed', 'failed', 'ignored') then v ->> 'status' else 'failed' end,
         processed_at = case when v ->> 'status' in ('processed', 'ignored') then now() else processed_at end,
         last_error = left(v ->> 'error', 300)
   where id = v ->> 'id';
  return jsonb_build_object('ok', true);
end;
$$;

create function giving.op_sync_checkout(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i giving.intents;
  v_status giving.intent_status;
begin
  select * into i from giving.intents where id = nullif(v ->> 'intent_id', '')::uuid for update;
  if not found or (i.stripe_checkout_session_id is not null and i.stripe_checkout_session_id <> v ->> 'session_id') then
    return jsonb_build_object('ignored', true);
  end if;

  v_status := i.status;
  if v ->> 'status' = 'expired' and i.status = 'open' then
    v_status := 'expired';
  elsif v ->> 'status' = 'complete' then
    if v ->> 'payment_status' in ('paid', 'no_payment_required') then
      v_status := 'completed';
    elsif coalesce((v ->> 'async_failed')::boolean, false) then
      v_status := case when i.status = 'completed' then i.status else 'failed' end;
    elsif i.status = 'open' then
      v_status := 'processing';
    end if;
  end if;

  update giving.intents
     set status = v_status,
         stripe_checkout_session_id = coalesce(stripe_checkout_session_id, v ->> 'session_id'),
         donor_name = coalesce(left(nullif(v ->> 'donor_name', ''), 200), donor_name),
         donor_email = coalesce(left(lower(nullif(v ->> 'donor_email', '')), 254), donor_email),
         livemode = coalesce((v ->> 'livemode')::boolean, livemode)
   where id = i.id;

  if i.profile_id is not null and nullif(v ->> 'customer_id', '') is not null then
    insert into giving.customers (profile_id, stripe_customer_id, livemode)
    values (i.profile_id, v ->> 'customer_id', coalesce((v ->> 'livemode')::boolean, false))
    on conflict do nothing;
  end if;

  -- Events can arrive before this one: fill in donor details recorded only on
  -- the checkout, and queue any acknowledgment that had no recipient yet.
  select * into i from giving.intents where id = i.id;
  update giving.commitments
     set donor_name = coalesce(donor_name, i.donor_name), donor_email = coalesce(donor_email, i.donor_email)
   where intent_id = i.id;
  update giving.payments p
     set donor_name = coalesce(p.donor_name, i.donor_name), donor_email = coalesce(p.donor_email, i.donor_email)
   where p.intent_id = i.id;
  perform giving.enqueue_email('acknowledgment', 'ack:' || p.id, giving.recipient(p.profile_id, p.donor_email),
                               p.id, p.commitment_id, null, null, p.livemode)
     from giving.payments p
    where p.intent_id = i.id and p.status = 'succeeded';

  return jsonb_build_object('intent_id', i.id, 'status', v_status, 'frequency', i.frequency, 'changed', v_status <> i.status);
end;
$$;

-- One-time gift, keyed by PaymentIntent.
create function giving.op_sync_payment(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i giving.intents;
  p giving.payments;
  v_new giving.payment_status := giving.map_pi_status(v ->> 'pi_status', nullif(v ->> 'failure_code', ''));
  v_old giving.payment_status;
  v_created boolean := false;
begin
  select * into i from giving.intents where id = nullif(v ->> 'intent_id', '')::uuid;
  if not found or i.frequency <> 'one_time' then
    return jsonb_build_object('ignored', true);
  end if;

  select * into p from giving.payments where stripe_payment_intent_id = v ->> 'payment_intent_id' for update;
  if not found then
    insert into giving.payments (
      source, status, profile_id, donor_name, donor_email, fund_id, fund_name, amount_cents, frequency, intent_id,
      stripe_payment_intent_id, stripe_charge_id, failure_code, received_at, livemode, fee_status
    )
    values (
      'stripe', v_new, i.profile_id,
      coalesce(left(nullif(v ->> 'donor_name', ''), 200), i.donor_name),
      coalesce(left(lower(nullif(v ->> 'donor_email', '')), 254), i.donor_email),
      i.fund_id, (select name from giving.funds where id = i.fund_id),
      coalesce(nullif((v ->> 'amount_cents')::integer, 0), i.amount_cents), 'one_time', i.id,
      v ->> 'payment_intent_id', nullif(v ->> 'charge_id', ''), left(nullif(v ->> 'failure_code', ''), 100),
      case when v_new = 'succeeded' then coalesce(giving.ts(v ->> 'succeeded_at'), now()) end,
      coalesce((v ->> 'livemode')::boolean, false),
      case when v_new = 'succeeded' then 'pending' else 'not_applicable' end
    )
    on conflict (stripe_payment_intent_id) do nothing
    returning * into p;
    if p.id is null then
      select * into p from giving.payments where stripe_payment_intent_id = v ->> 'payment_intent_id' for update;
    else
      v_created := true;
    end if;
    v_old := case when v_created then 'pending'::giving.payment_status else p.status end;
  else
    v_old := p.status;
  end if;

  if not v_created then
    update giving.payments
       set status = giving.next_status(p.status, v_new),
           donor_name = coalesce(donor_name, left(nullif(v ->> 'donor_name', ''), 200), i.donor_name),
           donor_email = coalesce(donor_email, left(lower(nullif(v ->> 'donor_email', '')), 254), i.donor_email),
           stripe_charge_id = coalesce(nullif(v ->> 'charge_id', ''), stripe_charge_id),
           failure_code = case when giving.next_status(p.status, v_new) = 'failed' then left(nullif(v ->> 'failure_code', ''), 100) else failure_code end,
           received_at = case when received_at is null and giving.next_status(p.status, v_new) = 'succeeded'
                              then coalesce(giving.ts(v ->> 'succeeded_at'), now()) else received_at end,
           fee_status = case when fee_status = 'not_applicable' and giving.next_status(p.status, v_new) = 'succeeded' then 'pending' else fee_status end,
           amount_cents = case when p.status <> 'succeeded' and giving.next_status(p.status, v_new) = 'succeeded'
                               then coalesce(nullif((v ->> 'amount_cents')::integer, 0), amount_cents) else amount_cents end
     where id = p.id
    returning * into p;
  end if;

  if p.status = 'succeeded' then
    perform giving.apply_fee(p.id, v -> 'fee');
    update giving.intents set status = 'completed' where id = i.id and status <> 'completed';
  end if;

  -- Idempotent (dedupe key); retried here in case the recipient wasn't known yet.
  if p.status = 'succeeded' then
    perform giving.enqueue_email('acknowledgment', 'ack:' || p.id, giving.recipient(p.profile_id, p.donor_email),
                                 p.id, null, null, null, p.livemode);
  end if;

  return jsonb_build_object('payment_id', p.id, 'status', p.status, 'created', v_created, 'changed', v_created or v_old <> p.status);
end;
$$;

create function giving.op_sync_subscription(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c giving.commitments;
  i giving.intents;
  v_old text;
  v_created boolean := false;
  v_freq giving.frequency := case v ->> 'interval' when 'week' then 'weekly'::giving.frequency when 'month' then 'monthly'::giving.frequency end;
begin
  select * into c from giving.commitments where stripe_subscription_id = v ->> 'subscription_id' for update;
  if not found then
    select * into i from giving.intents where id = nullif(v ->> 'intent_id', '')::uuid;
    if not found or i.frequency = 'one_time' then
      return jsonb_build_object('ignored', true);
    end if;
    insert into giving.commitments (
      intent_id, profile_id, fund_id, fund_name, amount_cents, frequency, status, stripe_subscription_id, stripe_customer_id,
      stripe_item_id, next_payment_at, cancel_at_period_end, canceled_at, ended_at, donor_name, donor_email, livemode
    )
    values (
      i.id, i.profile_id, i.fund_id, (select name from giving.funds where id = i.fund_id),
      coalesce(nullif((v ->> 'amount_cents')::integer, 0), i.amount_cents), coalesce(v_freq, i.frequency),
      v ->> 'status', v ->> 'subscription_id', nullif(v ->> 'customer_id', ''), nullif(v ->> 'item_id', ''),
      giving.ts(v ->> 'next_payment_at'), coalesce((v ->> 'cancel_at_period_end')::boolean, false),
      giving.ts(v ->> 'canceled_at'), giving.ts(v ->> 'ended_at'),
      coalesce(left(nullif(v ->> 'donor_name', ''), 200), i.donor_name),
      coalesce(left(lower(nullif(v ->> 'donor_email', '')), 254), i.donor_email),
      coalesce((v ->> 'livemode')::boolean, false)
    )
    on conflict (stripe_subscription_id) do nothing
    returning * into c;
    if c.id is null then
      return giving.op_sync_subscription(v);
    end if;
    v_created := true;
    update giving.intents set status = 'completed' where id = i.id and status <> 'completed';
    if i.profile_id is not null and nullif(v ->> 'customer_id', '') is not null then
      insert into giving.customers (profile_id, stripe_customer_id, livemode)
      values (i.profile_id, v ->> 'customer_id', c.livemode)
      on conflict do nothing;
    end if;
    return jsonb_build_object('commitment_id', c.id, 'status', c.status, 'created', true, 'changed', true);
  end if;

  v_old := c.status;
  update giving.commitments
     set status = v ->> 'status',
         -- The amount describes future gifts only; past payments keep their own amounts.
         amount_cents = coalesce(nullif((v ->> 'amount_cents')::integer, 0), amount_cents),
         stripe_item_id = coalesce(nullif(v ->> 'item_id', ''), stripe_item_id),
         next_payment_at = giving.ts(v ->> 'next_payment_at'),
         cancel_at_period_end = coalesce((v ->> 'cancel_at_period_end')::boolean, false),
         canceled_at = giving.ts(v ->> 'canceled_at'),
         ended_at = giving.ts(v ->> 'ended_at')
   where id = c.id
  returning * into c;

  if v_old <> 'canceled' and c.status = 'canceled' then
    perform giving.enqueue_email('cancellation', 'cancel:' || c.id, giving.recipient(c.profile_id, c.donor_email),
                                 null, c.id, null, null, c.livemode);
  end if;
  return jsonb_build_object('commitment_id', c.id, 'status', c.status, 'created', false, 'changed', v_old <> c.status);
end;
$$;

-- A recurring payment, keyed by Invoice.
create function giving.op_sync_invoice(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c giving.commitments;
  p giving.payments;
  v_new giving.payment_status := case v ->> 'outcome'
    when 'succeeded' then 'succeeded'::giving.payment_status
    when 'failed' then 'failed'::giving.payment_status
    else 'pending'::giving.payment_status end;
  v_old giving.payment_status;
  v_created boolean := false;
begin
  select * into c from giving.commitments where stripe_subscription_id = v ->> 'subscription_id';
  if not found then
    return jsonb_build_object('needs_subscription', true);
  end if;

  select * into p from giving.payments where stripe_invoice_id = v ->> 'invoice_id' for update;
  if not found then
    insert into giving.payments (
      source, status, profile_id, donor_name, donor_email, fund_id, fund_name, amount_cents, frequency, intent_id, commitment_id,
      stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id, failure_code, received_at, livemode, fee_status
    )
    values (
      'stripe', v_new, c.profile_id, c.donor_name, c.donor_email, c.fund_id, (select name from giving.funds where id = c.fund_id),
      coalesce(nullif((v ->> 'amount_cents')::integer, 0), c.amount_cents), c.frequency, c.intent_id, c.id,
      v ->> 'invoice_id', nullif(v ->> 'payment_intent_id', ''), nullif(v ->> 'charge_id', ''),
      left(nullif(v ->> 'failure_code', ''), 100),
      case when v_new = 'succeeded' then coalesce(giving.ts(v ->> 'paid_at'), now()) end,
      c.livemode, case when v_new = 'succeeded' then 'pending' else 'not_applicable' end
    )
    on conflict (stripe_invoice_id) do nothing
    returning * into p;
    if p.id is null then
      return giving.op_sync_invoice(v);
    end if;
    v_created := true;
    v_old := 'pending';
  else
    v_old := p.status;
    update giving.payments
       set status = giving.next_status(p.status, v_new),
           donor_name = coalesce(donor_name, c.donor_name),
           donor_email = coalesce(donor_email, c.donor_email),
           stripe_payment_intent_id = coalesce(nullif(v ->> 'payment_intent_id', ''), stripe_payment_intent_id),
           stripe_charge_id = coalesce(nullif(v ->> 'charge_id', ''), stripe_charge_id),
           failure_code = case when giving.next_status(p.status, v_new) = 'failed' then left(nullif(v ->> 'failure_code', ''), 100) else failure_code end,
           received_at = case when received_at is null and giving.next_status(p.status, v_new) = 'succeeded'
                              then coalesce(giving.ts(v ->> 'paid_at'), now()) else received_at end,
           fee_status = case when fee_status = 'not_applicable' and giving.next_status(p.status, v_new) = 'succeeded' then 'pending' else fee_status end,
           amount_cents = case when p.status <> 'succeeded' and giving.next_status(p.status, v_new) = 'succeeded'
                               then coalesce(nullif((v ->> 'amount_cents')::integer, 0), amount_cents) else amount_cents end
     where id = p.id
    returning * into p;
  end if;

  if p.status = 'succeeded' then
    perform giving.apply_fee(p.id, v -> 'fee');
  end if;
  if p.status = 'succeeded' then
    perform giving.enqueue_email('acknowledgment', 'ack:' || p.id, giving.recipient(p.profile_id, p.donor_email),
                                 p.id, c.id, null, null, p.livemode);
  elsif p.status = 'failed' then
    perform giving.enqueue_email('payment_failed', 'failed:' || p.stripe_invoice_id, giving.recipient(p.profile_id, p.donor_email),
                                 p.id, c.id, null, nullif(v ->> 'recovery_url', ''), p.livemode);
  end if;

  return jsonb_build_object('payment_id', p.id, 'status', p.status, 'created', v_created, 'changed', v_created or v_old <> p.status);
end;
$$;

create function giving.find_payment(p_charge text, p_pi text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from giving.payments
   where (nullif(p_charge, '') is not null and stripe_charge_id = p_charge)
      or (nullif(p_pi, '') is not null and stripe_payment_intent_id = p_pi)
   limit 1;
$$;

create function giving.op_sync_charge(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment uuid := giving.find_payment(v ->> 'charge_id', v ->> 'payment_intent_id');
begin
  if v_payment is null then
    return jsonb_build_object('ignored', true);
  end if;
  update giving.payments set stripe_charge_id = coalesce(stripe_charge_id, nullif(v ->> 'charge_id', '')) where id = v_payment;
  if (select status from giving.payments where id = v_payment) = 'succeeded' then
    perform giving.apply_fee(v_payment, v -> 'fee');
  end if;
  return jsonb_build_object('payment_id', v_payment);
end;
$$;

create function giving.op_sync_refund(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment uuid := giving.find_payment(v ->> 'charge_id', v ->> 'payment_intent_id');
  r giving.refunds;
  v_old text;
  p giving.payments;
begin
  if v_payment is null then
    return jsonb_build_object('ignored', true);
  end if;
  select status into v_old from giving.refunds where stripe_refund_id = v ->> 'refund_id';

  insert into giving.refunds (payment_id, stripe_refund_id, amount_cents, status, reason, refunded_at, initiated_by)
  values (
    v_payment, v ->> 'refund_id', (v ->> 'amount_cents')::integer, v ->> 'status', left(nullif(v ->> 'reason', ''), 100),
    case when v ->> 'status' = 'succeeded' then coalesce(giving.ts(v ->> 'created'), now()) end,
    nullif(v ->> 'initiated_by', '')::uuid
  )
  on conflict (stripe_refund_id) do update
    set status = excluded.status,
        amount_cents = excluded.amount_cents,
        reason = coalesce(excluded.reason, giving.refunds.reason),
        refunded_at = coalesce(giving.refunds.refunded_at, excluded.refunded_at),
        initiated_by = coalesce(giving.refunds.initiated_by, excluded.initiated_by)
  returning * into r;

  if r.status = 'succeeded' and v_old is distinct from 'succeeded' then
    select * into p from giving.payments where id = v_payment;
    perform giving.enqueue_email('refund', 'refund:' || r.id, giving.recipient(p.profile_id, p.donor_email),
                                 p.id, p.commitment_id, r.id, null, p.livemode);
  end if;
  return jsonb_build_object('refund_id', r.id, 'payment_id', v_payment, 'created', v_old is null, 'changed', v_old is distinct from r.status);
end;
$$;

create function giving.op_sync_dispute(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment uuid := giving.find_payment(v ->> 'charge_id', v ->> 'payment_intent_id');
  d giving.disputes;
  v_old text;
begin
  if v_payment is null then
    return jsonb_build_object('ignored', true);
  end if;
  select status into v_old from giving.disputes where stripe_dispute_id = v ->> 'dispute_id';
  insert into giving.disputes (payment_id, stripe_dispute_id, amount_cents, status, reason, opened_at, closed_at)
  values (
    v_payment, v ->> 'dispute_id', (v ->> 'amount_cents')::integer, v ->> 'status', left(nullif(v ->> 'reason', ''), 100),
    giving.ts(v ->> 'created'),
    case when v ->> 'status' in ('won', 'lost', 'warning_closed', 'prevented') then now() end
  )
  on conflict (stripe_dispute_id) do update
    set status = excluded.status,
        amount_cents = excluded.amount_cents,
        reason = coalesce(excluded.reason, giving.disputes.reason),
        closed_at = case when excluded.status in ('won', 'lost', 'warning_closed', 'prevented')
                         then coalesce(giving.disputes.closed_at, now()) else null end
  returning * into d;
  return jsonb_build_object('dispute_id', d.id, 'payment_id', v_payment, 'created', v_old is null, 'changed', v_old is distinct from d.status);
end;
$$;

-- Claims emails for sending (pending, retryable failures, or stuck sends)
-- and returns everything the server needs to render them.
create function giving.op_email_claim(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
  v_limit integer := least(greatest(coalesce((v ->> 'limit')::integer, 10), 1), 50);
begin
  with picked as (
    select id from giving.email_outbox
     where (nullif(v ->> 'id', '') is null or id = (v ->> 'id')::uuid)
       and (status = 'pending'
            or (status = 'failed' and attempts < 5)
            or (status = 'sending' and updated_at < now() - interval '10 minutes'))
     order by created_at
     limit v_limit
     for update skip locked
  ), claimed as (
    update giving.email_outbox e
       set status = 'sending', attempts = e.attempts + 1
      from picked
     where e.id = picked.id
    returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'kind', e.kind,
           'dedupe_key', e.dedupe_key,
           'to', e.to_email,
           'livemode', e.livemode,
           'recovery_url', e.recovery_url,
           'first_name', coalesce(
             nullif(btrim(pr.preferred_name), ''), nullif(btrim(pr.first_name), ''),
             nullif(split_part(btrim(coalesce(p.donor_name, c.donor_name, '')), ' ', 1), '')),
           'is_guest', coalesce(p.profile_id, c.profile_id) is null,
           'amount_cents', coalesce(r.amount_cents, p.amount_cents, c.amount_cents),
           'payment_amount_cents', p.amount_cents,
           'fund_name', coalesce(p.fund_name, c.fund_name),
           'frequency', coalesce(p.frequency, c.frequency),
           'received_at', p.received_at,
           'next_payment_at', c.next_payment_at,
           'claim_code', case when e.kind = 'acknowledgment' and p.profile_id is null and p.source = 'stripe'
                              then giving.claim_code(p.id) end,
           'acknowledgment_message', (select acknowledgment_message from giving.settings),
           'church_name', (select church_name from public.church_settings limit 1),
           'timezone', (select timezone from public.church_settings limit 1)
         )), '[]'::jsonb)
    into v_out
    from claimed e
    left join giving.payments p on p.id = e.payment_id
    left join giving.commitments c on c.id = coalesce(e.commitment_id, p.commitment_id)
    left join giving.refunds r on r.id = e.refund_id
    left join public.profiles pr on pr.id = coalesce(p.profile_id, c.profile_id);
  return v_out;
end;
$$;

create function giving.op_email_result(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update giving.email_outbox
     set status = case when v ->> 'status' in ('sent', 'failed', 'suppressed') then v ->> 'status' else 'failed' end,
         provider_message_id = coalesce(left(nullif(v ->> 'provider_id', ''), 100), provider_message_id),
         last_error = left(nullif(v ->> 'error', ''), 300),
         sent_at = case when v ->> 'status' = 'sent' then now() else sent_at end
   where id = (v ->> 'id')::uuid and status = 'sending';
  return jsonb_build_object('ok', found);
end;
$$;

-- Verified ownership of a past guest gift: the member must know the gift
-- reference that was emailed to the guest address, and that address must be
-- the member's own (verified) sign-in email. Matching email alone is never enough.
create function giving.op_claim_gift(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := (v ->> 'profile_id')::uuid;
  v_email text;
  v_code text := upper(regexp_replace(coalesce(v ->> 'code', ''), '[^A-Za-z0-9]', '', 'g'));
  p giving.payments;
  v_match uuid;
begin
  if not (giving.op_rate_limit(jsonb_build_object('key', 'claim:' || v_profile, 'limit', 5, 'window_seconds', 3600)) ->> 'allowed')::boolean then
    raise exception 'Too many attempts. Please try again in an hour.' using errcode = 'P0001';
  end if;
  select lower(nullif(btrim(email), '')) into v_email from public.profiles where id = v_profile;
  -- Failures are returned, not raised, so the attempt still counts toward the limit.
  if v_email is null or char_length(v_code) <> 10 then
    return jsonb_build_object('ok', false);
  end if;

  for p in
    select * from giving.payments
     where profile_id is null and source = 'stripe' and status = 'succeeded' and not livemode
       and lower(donor_email) = v_email
  loop
    if replace(giving.claim_code(p.id), '-', '') = v_code then
      v_match := p.id;
      exit;
    end if;
  end loop;

  if v_match is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into p from giving.payments where id = v_match;
  update giving.payments set profile_id = v_profile, claimed_at = now() where id = v_match;
  if p.commitment_id is not null then
    update giving.commitments set profile_id = v_profile where id = p.commitment_id and profile_id is null;
    update giving.payments set profile_id = v_profile, claimed_at = now()
     where commitment_id = p.commitment_id and profile_id is null and lower(donor_email) = v_email;
  end if;
  perform giving.audit('giving.gift_claimed', 'payment', v_match::text, '{}'::jsonb, v_profile);
  return jsonb_build_object('ok', true, 'payment_id', v_match);
end;
$$;

-- Details the server needs to change or open the portal for a member's own
-- recurring gift. Returns nothing unless the member owns it.
create function giving.op_owner_commitment(v jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'commitment_id', c.id, 'subscription_id', c.stripe_subscription_id, 'item_id', c.stripe_item_id,
      'customer_id', c.stripe_customer_id, 'product_id', f.stripe_test_product_id, 'fund_id', f.id,
      'currency', c.currency, 'frequency', c.frequency, 'status', c.status, 'amount_cents', c.amount_cents)
    from giving.commitments c
    join giving.funds f on f.id = c.fund_id
    where c.id = (v ->> 'commitment_id')::uuid and c.profile_id = (v ->> 'profile_id')::uuid
  ), '{}'::jsonb);
$$;

create function giving.op_owner_customer(v jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('customer_id', coalesce(
    (select stripe_customer_id from giving.customers where profile_id = (v ->> 'profile_id')::uuid and not livemode),
    (select stripe_customer_id from giving.commitments
      where profile_id = (v ->> 'profile_id')::uuid and stripe_customer_id is not null
      order by created_at desc limit 1)));
$$;

-- What the "thank you" page may show for a checkout session: never more than
-- amount, fund, frequency, and confirmation state.
create function giving.op_checkout_status(v jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'amount_cents', i.amount_cents,
      'frequency', i.frequency,
      'fund_name', f.name,
      'state', case
        when i.frequency = 'one_time' then coalesce((
          select case p.status when 'succeeded' then 'confirmed' when 'failed' then 'failed' when 'canceled' then 'failed' else 'processing' end
          from giving.payments p where p.intent_id = i.id order by p.created_at desc limit 1),
          case i.status when 'expired' then 'expired' when 'failed' then 'failed' else 'processing' end)
        else coalesce((
          select case when bool_or(p.status = 'succeeded') then 'confirmed' when bool_or(p.status = 'failed') then 'failed' else 'processing' end
          from giving.payments p join giving.commitments c on c.id = p.commitment_id where c.intent_id = i.id),
          case i.status when 'expired' then 'expired' when 'failed' then 'failed' else 'processing' end)
      end)
    from giving.intents i
    join giving.funds f on f.id = i.fund_id
    where i.stripe_checkout_session_id = v ->> 'session_id'
  ), jsonb_build_object('state', 'unknown'));
$$;

create function giving.op_pending_fees(v jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', id, 'charge_id', stripe_charge_id, 'payment_intent_id', stripe_payment_intent_id)), '[]'::jsonb)
  from (
    select id, stripe_charge_id, stripe_payment_intent_id from giving.payments
     where source = 'stripe' and status = 'succeeded' and fee_status in ('pending', 'unavailable')
     order by received_at
     limit least(greatest(coalesce((v ->> 'limit')::integer, 50), 1), 200)
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Entry point
-- ---------------------------------------------------------------------------
create function public.giving_ingest(p_op text, p_payload text, p_ts bigint, p_sig text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v jsonb;
begin
  select value into v_key from giving.secrets where name = 'ingest';
  if v_key is null then
    raise exception 'Giving is not configured.' using errcode = '42501';
  end if;
  if p_ts is null or abs(extract(epoch from now()) - p_ts) > 300 then
    raise exception 'Request expired.' using errcode = '42501';
  end if;
  if p_sig is null
     or p_sig <> encode(extensions.hmac(coalesce(p_op, '') || '.' || p_ts::text || '.' || coalesce(p_payload, ''), v_key, 'sha256'), 'hex') then
    raise exception 'Invalid signature.' using errcode = '42501';
  end if;

  v := p_payload::jsonb;
  return case p_op
    when 'rate_limit' then giving.op_rate_limit(v)
    when 'checkout_prepare' then giving.op_checkout_prepare(v)
    when 'checkout_attach' then giving.op_checkout_attach(v)
    when 'checkout_status' then giving.op_checkout_status(v)
    when 'customer_link' then giving.op_customer_link(v)
    when 'fund_product' then giving.op_fund_product(v)
    when 'event_begin' then giving.op_event_begin(v)
    when 'event_finish' then giving.op_event_finish(v)
    when 'sync_checkout' then giving.op_sync_checkout(v)
    when 'sync_payment' then giving.op_sync_payment(v)
    when 'sync_subscription' then giving.op_sync_subscription(v)
    when 'sync_invoice' then giving.op_sync_invoice(v)
    when 'sync_charge' then giving.op_sync_charge(v)
    when 'sync_refund' then giving.op_sync_refund(v)
    when 'sync_dispute' then giving.op_sync_dispute(v)
    when 'email_claim' then giving.op_email_claim(v)
    when 'email_result' then giving.op_email_result(v)
    when 'claim_gift' then giving.op_claim_gift(v)
    when 'owner_commitment' then giving.op_owner_commitment(v)
    when 'owner_customer' then giving.op_owner_customer(v)
    when 'pending_fees' then giving.op_pending_fees(v)
    else null
  end;
end;
$$;

revoke execute on all functions in schema giving from public, anon, authenticated, service_role;
revoke execute on function public.giving_ingest(text, text, bigint, text) from public, service_role;
grant execute on function public.giving_ingest(text, text, bigint, text) to anon, authenticated;
