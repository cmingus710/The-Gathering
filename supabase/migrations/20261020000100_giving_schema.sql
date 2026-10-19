-- Phase 3 · Giving: schema, finance capabilities, and funds.
--
-- Design notes
-- * All giving data lives in the private `giving` schema. It is not exposed
--   through the Supabase Data API (only `public` is), and the API roles have
--   no privileges on it. Every read and write goes through SECURITY DEFINER
--   functions in `public` that check who is asking:
--     - members read only their own gifts (my_giving*),
--     - finance users need an explicit finance.* capability (finance_*),
--     - the app server writes provider-confirmed payment state through
--       giving_ingest(), which requires an HMAC signature made with a secret
--       shared only between the database and the server (next migration).
--   Giving data never appears in directory, profile, or announcement queries.
-- * Finance capabilities must be granted explicitly. Super administrators
--   no longer receive finance.* implicitly; they can assign a finance role
--   (including to themselves) through roles.manage, which is audited.
-- * Amounts are integer cents in USD. Test (Stripe test mode) and live data
--   are separated by `livemode`; live mode is blocked in this phase.
-- * Nothing is ever deleted: corrections and reversals are new rows/states.

-- ---------------------------------------------------------------------------
-- Finance capabilities and roles
-- ---------------------------------------------------------------------------
update public.capabilities set available = true, description = 'View contribution records, recurring gifts, and finance totals'
 where key = 'finance.view';
update public.capabilities set available = true, description = 'Manage funds, giving settings, and email delivery'
 where key = 'finance.manage';

insert into public.capabilities (key, description, available) values
  ('finance.record', 'Record, correct, and reverse cash and check gifts; associate donors', true),
  ('finance.export', 'Export contribution data as CSV', true),
  ('finance.refund', 'Issue refunds for card and wallet gifts', true);

update public.roles
   set assignable = true,
       description = 'Full giving administration: records, manual gifts, exports, funds, and refunds.'
 where key = 'finance_admin';

insert into public.roles (key, name, description, assignable, sort_order) values
  ('finance_viewer', 'Finance viewer', 'Read-only access to contribution records and totals.', true, 45);

insert into public.role_capabilities (role_key, capability_key) values
  ('finance_admin', 'finance.record'),
  ('finance_admin', 'finance.export'),
  ('finance_admin', 'finance.refund'),
  ('finance_viewer', 'finance.view');

-- Finance requires an explicit role grant, even for super administrators.
create or replace function public.has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id
    where p.id = (select auth.uid())
      and p.membership_status = 'approved'
      and (
        (ur.role_key = 'super_admin' and p_capability not like 'finance.%')
        or exists (
          select 1
          from public.role_capabilities rc
          join public.capabilities c on c.key = rc.capability_key
          where rc.role_key = ur.role_key
            and rc.capability_key = p_capability
            and c.available
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Private schema
-- ---------------------------------------------------------------------------
create schema giving;
revoke all on schema giving from public, anon, authenticated;
comment on schema giving is 'Contribution records. No API role has access; use the public.giving_* / my_giving* / finance_* functions.';

create type giving.frequency as enum ('one_time', 'weekly', 'monthly');
create type giving.intent_status as enum ('open', 'processing', 'completed', 'expired', 'failed');
create type giving.payment_source as enum ('stripe', 'cash', 'check');
create type giving.payment_status as enum ('pending', 'succeeded', 'failed', 'canceled', 'reversed');

-- Server-only secrets (the ingest HMAC key). Set by the owner in the SQL
-- editor; never readable through the API.
create table giving.secrets (
  name text primary key,
  value text not null check (char_length(value) >= 32),
  updated_at timestamptz not null default now()
);

create table giving.settings (
  id boolean primary key default true check (id),
  min_amount_cents integer not null default 100 check (min_amount_cents >= 100),
  max_amount_cents integer not null default 1000000 check (max_amount_cents <= 2500000),
  acknowledgment_message text not null default
    'Thank you for your generous gift. Your support helps our church family worship, serve, and care for one another.'
    check (char_length(acknowledgment_message) between 1 and 1000),
  -- Annual statement identity and wording. Statements stay in draft until a
  -- finance manager fills these in and marks them approved.
  statement_org_name text check (char_length(statement_org_name) <= 120),
  statement_org_address text check (char_length(statement_org_address) <= 300),
  statement_tax_id text check (char_length(statement_tax_id) <= 40),
  statement_wording text check (char_length(statement_wording) <= 2000),
  statement_approved boolean not null default false,
  -- Live payments are blocked in Phase 3. Changing this requires a reviewed migration.
  allow_live_mode boolean not null default false check (not allow_live_mode),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  check (min_amount_cents < max_amount_cents),
  check (not statement_approved or (statement_org_name is not null and statement_wording is not null))
);
insert into giving.settings (id) values (true);

create table giving.funds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 300),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  -- Stripe Product used for this fund's prices, per mode (created lazily by the server).
  stripe_test_product_id text,
  stripe_live_product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index funds_name_key on giving.funds (lower(btrim(name)));

insert into giving.funds (name, description, sort_order) values
  ('General Offering', 'Supports the everyday life and ministry of the church.', 10),
  ('Missions', 'Supports missions and outreach.', 20),
  ('Youth', 'Supports youth ministry.', 30),
  ('Benevolence', 'Helps people in our community with practical needs.', 40);

-- Trusted mapping from an app account to its Stripe customer. Written only by
-- the server (giving_ingest); user-supplied customer ids are never accepted.
create table giving.customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  unique (profile_id, livemode)
);

-- A checkout attempt: what the donor chose before paying. Not a gift.
create table giving.intents (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 100),
  profile_id uuid references public.profiles (id) on delete set null,
  fund_id uuid not null references giving.funds (id),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  frequency giving.frequency not null,
  status giving.intent_status not null default 'open',
  stripe_checkout_session_id text unique,
  checkout_url text,
  session_expires_at timestamptz,
  donor_name text check (char_length(donor_name) <= 200),
  donor_email text check (char_length(donor_email) <= 254),
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index intents_profile_idx on giving.intents (profile_id);
create index intents_fund_idx on giving.intents (fund_id);

-- A recurring commitment (Stripe subscription). Separate from the payments it produces.
create table giving.commitments (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid unique references giving.intents (id),
  profile_id uuid references public.profiles (id) on delete set null,
  fund_id uuid not null references giving.funds (id),
  fund_name text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  frequency giving.frequency not null check (frequency <> 'one_time'),
  status text not null,
  stripe_subscription_id text not null unique,
  stripe_customer_id text,
  stripe_item_id text,
  next_payment_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  donor_name text check (char_length(donor_name) <= 200),
  donor_email text check (char_length(donor_email) <= 254),
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index commitments_profile_idx on giving.commitments (profile_id);
create index commitments_fund_idx on giving.commitments (fund_id);

-- Contributions: Stripe payments and manual (cash/check) gifts. Only
-- status = 'succeeded' counts as received. The fund is fixed when the row is
-- created (fund_name is a snapshot), so renaming or archiving a fund or
-- changing a recurring gift never rewrites history.
create table giving.payments (
  id uuid primary key default gen_random_uuid(),
  source giving.payment_source not null,
  status giving.payment_status not null,
  profile_id uuid references public.profiles (id) on delete set null,
  donor_name text check (char_length(donor_name) <= 200),
  donor_email text check (char_length(donor_email) <= 254),
  fund_id uuid not null references giving.funds (id),
  fund_name text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  frequency giving.frequency,
  intent_id uuid references giving.intents (id),
  commitment_id uuid references giving.commitments (id),
  stripe_payment_intent_id text unique,
  stripe_charge_id text unique,
  stripe_invoice_id text unique,
  failure_code text check (char_length(failure_code) <= 100),
  -- Processing fee from the Stripe balance transaction. Null until known; never estimated.
  fee_cents integer check (fee_cents >= 0),
  net_cents integer,
  fee_status text not null default 'not_applicable' check (fee_status in ('pending', 'known', 'unavailable', 'not_applicable')),
  stripe_balance_transaction_id text,
  received_at timestamptz,
  -- Manual gifts
  received_on date,
  check_reference text check (char_length(check_reference) <= 60),
  internal_note text check (char_length(internal_note) <= 500),
  recorded_by uuid references public.profiles (id) on delete set null,
  manual_token uuid unique,
  replaces_payment_id uuid references giving.payments (id),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles (id) on delete set null,
  reversal_reason text check (char_length(reversal_reason) <= 300),
  claimed_at timestamptz,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source = 'stripe') = (stripe_payment_intent_id is not null or stripe_invoice_id is not null)),
  check (source <> 'stripe' or received_on is null),
  check (source = 'stripe' or (received_on is not null and manual_token is not null)),
  check (check_reference is null or source = 'check'),
  check ((status = 'reversed') = (reversed_at is not null))
);
create index payments_profile_idx on giving.payments (profile_id);
create index payments_fund_idx on giving.payments (fund_id);
create index payments_commitment_idx on giving.payments (commitment_id);
create index payments_intent_idx on giving.payments (intent_id);
create index payments_received_idx on giving.payments (received_at);
create index payments_donor_email_idx on giving.payments (lower(donor_email)) where profile_id is null;

create table giving.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references giving.payments (id),
  stripe_refund_id text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  status text not null,
  reason text check (char_length(reason) <= 100),
  refunded_at timestamptz,
  initiated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_payment_idx on giving.refunds (payment_id);

create table giving.disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references giving.payments (id),
  stripe_dispute_id text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  status text not null,
  reason text check (char_length(reason) <= 100),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index disputes_payment_idx on giving.disputes (payment_id);

-- Webhook event ledger: one row per Stripe event id (idempotency).
create table giving.stripe_events (
  id text primary key check (id ~ '^evt_'),
  type text not null,
  livemode boolean not null,
  stripe_created timestamptz,
  status text not null check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text check (char_length(last_error) <= 300)
);

-- Email delivery, tracked separately from payment state. dedupe_key makes
-- each acknowledgment/notice unique however often an event is delivered.
create table giving.email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  kind text not null check (kind in ('acknowledgment', 'payment_failed', 'cancellation', 'refund')),
  to_email text not null check (char_length(to_email) <= 254),
  payment_id uuid references giving.payments (id),
  commitment_id uuid references giving.commitments (id),
  refund_id uuid references giving.refunds (id),
  recovery_url text,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'suppressed')),
  attempts integer not null default 0,
  last_error text check (char_length(last_error) <= 300),
  provider_message_id text,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_status_idx on giving.email_outbox (status, updated_at);
create index email_outbox_payment_idx on giving.email_outbox (payment_id);
create index email_outbox_commitment_idx on giving.email_outbox (commitment_id);
create index email_outbox_refund_idx on giving.email_outbox (refund_id);

-- Fixed-window rate limits (checkout creation, gift claims).
create table giving.rate_limits (
  key text primary key check (char_length(key) <= 200),
  window_start timestamptz not null,
  count integer not null
);

create index customers_profile_idx on giving.customers (profile_id);
create index payments_replaces_idx on giving.payments (replaces_payment_id);
create index payments_recorded_by_idx on giving.payments (recorded_by);
create index payments_reversed_by_idx on giving.payments (reversed_by);
create index refunds_initiated_by_idx on giving.refunds (initiated_by);
create index settings_updated_by_idx on giving.settings (updated_by);

create function giving.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger funds_touch before update on giving.funds for each row execute function giving.touch_updated_at();
create trigger intents_touch before update on giving.intents for each row execute function giving.touch_updated_at();
create trigger commitments_touch before update on giving.commitments for each row execute function giving.touch_updated_at();
create trigger payments_touch before update on giving.payments for each row execute function giving.touch_updated_at();
create trigger refunds_touch before update on giving.refunds for each row execute function giving.touch_updated_at();
create trigger disputes_touch before update on giving.disputes for each row execute function giving.touch_updated_at();
create trigger email_outbox_touch before update on giving.email_outbox for each row execute function giving.touch_updated_at();
create trigger settings_touch before update on giving.settings for each row execute function giving.touch_updated_at();

-- RLS on as a backstop (no policies: the API roles have no access at all).
alter table giving.secrets enable row level security;
alter table giving.settings enable row level security;
alter table giving.funds enable row level security;
alter table giving.customers enable row level security;
alter table giving.intents enable row level security;
alter table giving.commitments enable row level security;
alter table giving.payments enable row level security;
alter table giving.refunds enable row level security;
alter table giving.disputes enable row level security;
alter table giving.stripe_events enable row level security;
alter table giving.email_outbox enable row level security;
alter table giving.rate_limits enable row level security;

revoke all on all tables in schema giving from public, anon, authenticated, service_role;
revoke execute on all functions in schema giving from public, anon, authenticated, service_role;
alter default privileges in schema giving revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema giving revoke execute on functions from public, anon, authenticated, service_role;
