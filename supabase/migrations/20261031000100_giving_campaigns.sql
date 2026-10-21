-- Phase 13 · Giving: fundraising campaigns and a progress meter.
--
-- A campaign is a goal ("Roof repair, $25,000") that gifts can be made
-- toward. It always posts to one existing fund, so campaign gifts are
-- ordinary contributions in the existing accounting (fund totals,
-- statements, exports); the campaign is an extra attribution on top.
--
-- Design notes (details in docs/phase-13/campaigns.md)
-- * Additive only. New table giving.campaigns, a nullable campaign_id on
--   giving.intents, giving.commitments, and giving.payments, a private
--   campaign-images bucket, and new functions. One existing function is
--   replaced with a compatible body: giving.op_checkout_prepare now accepts
--   an optional campaign_id (callers that don't send one behave exactly as
--   before).
-- * Attribution is decided in the database, like fund_id: the intent gets
--   campaign_id at checkout (validated: published, open by date, fund
--   matches, members-only campaigns need an approved member), and payment
--   and commitment rows inherit it from the intent/commitment when they are
--   inserted (trigger). Stripe metadata still carries only gift_intent_id.
-- * campaign_id is immutable on every row once inserted (trigger), and no
--   historical gift is ever backfilled. Titles can change freely because
--   attribution is by id.
-- * Progress is computed on read from the source rows; there are no
--   counters, so concurrent or replayed webhooks can't race or double-count.
--   See giving.campaign_totals for the exact definition.
-- * Test and live are kept strictly apart: totals are per mode, and every
--   reader uses the mode the app runs in (giving.current_livemode(), which
--   is test while settings.allow_live_mode is pinned false).
-- * Public readers get aggregates only: never donors, gift counts,
--   individual amounts, or payment rows.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table giving.campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  -- Object name in the private campaign-images bucket (WebP, re-encoded by the app).
  image_path text check (image_path is null or (char_length(image_path) <= 200 and image_path ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.webp$')),
  image_alt text check (char_length(image_alt) <= 200),
  goal_cents bigint not null check (goal_cents between 100 and 1000000000),
  starts_on date,
  ends_on date,
  fund_id uuid not null references giving.funds (id),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  visibility text not null default 'members' check (visibility in ('public', 'members')),
  published_at timestamptz,
  closed_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index campaigns_fund_idx on giving.campaigns (fund_id);
create index campaigns_status_idx on giving.campaigns (status);
create index campaigns_created_by_idx on giving.campaigns (created_by);
create index campaigns_updated_by_idx on giving.campaigns (updated_by);
create trigger campaigns_touch before update on giving.campaigns for each row execute function giving.touch_updated_at();
alter table giving.campaigns enable row level security;
revoke all on giving.campaigns from public, anon, authenticated, service_role;

alter table giving.intents add column campaign_id uuid references giving.campaigns (id);
alter table giving.commitments add column campaign_id uuid references giving.campaigns (id);
alter table giving.payments add column campaign_id uuid references giving.campaigns (id);
create index intents_campaign_idx on giving.intents (campaign_id) where campaign_id is not null;
create index commitments_campaign_idx on giving.commitments (campaign_id) where campaign_id is not null;
create index payments_campaign_idx on giving.payments (campaign_id, livemode, status) where campaign_id is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The mode the app runs in. Live is blocked (settings.allow_live_mode has
-- CHECK false), so this is test mode until a reviewed migration changes it.
create function giving.current_livemode()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select allow_live_mode from giving.settings), false);
$$;

create function giving.church_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone giving.church_tz())::date;
$$;

-- Accepting online gifts: published and inside its (optional) dates, in the
-- church time zone. Closed, draft, and archived campaigns never accept gifts.
create function giving.campaign_open(c giving.campaigns)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.status = 'published'
     and (c.starts_on is null or c.starts_on <= giving.church_today())
     and (c.ends_on is null or c.ends_on >= giving.church_today());
$$;

-- Who may see a campaign outside finance: published or closed only (never
-- draft or archived); 'members' campaigns only for approved members.
create function giving.campaign_visible(c giving.campaigns)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.status in ('published', 'closed')
     and (c.visibility = 'public' or (select public.is_approved_member()));
$$;

-- Campaign totals for one mode (livemode true = live rows only, false = test
-- rows only; they are never mixed). Definition, per payment row with this
-- campaign_id, this livemode, and status = 'succeeded':
--   counted = greatest(amount - succeeded refunds - disputed amount, 0)
-- where "disputed amount" is every dispute on the payment that is lost or
-- still open (any status other than won / warning_closed / prevented).
-- A won dispute stops subtracting, so the amount is restored.
-- Pending, failed, canceled, and reversed (manual) payments never count,
-- nor do commitments or their future installments: only rows in payments
-- that have actually succeeded. Each Stripe PaymentIntent / Invoice is
-- one payments row (unique keys), so retries and duplicates count once.
create function giving.campaign_totals(p_campaign uuid, p_livemode boolean)
returns table (
  raised_cents bigint, gross_cents bigint, refunded_cents bigint, disputed_open_cents bigint, disputed_lost_cents bigint,
  gift_count integer, by_source jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with rows as (
    select p.source, p.amount_cents::bigint amount,
           coalesce((select sum(r.amount_cents) from giving.refunds r where r.payment_id = p.id and r.status = 'succeeded'), 0)::bigint refunded,
           coalesce((select sum(d.amount_cents) from giving.disputes d where d.payment_id = p.id and d.status = 'lost'), 0)::bigint lost,
           coalesce((select sum(d.amount_cents) from giving.disputes d
                      where d.payment_id = p.id and d.status not in ('won', 'lost', 'warning_closed', 'prevented')), 0)::bigint open
      from giving.payments p
     where p.campaign_id = p_campaign and p.livemode = p_livemode and p.status = 'succeeded'
  ), counted as (
    select r.*, greatest(r.amount - r.refunded - r.lost - r.open, 0) net from rows r
  )
  select coalesce(sum(net), 0)::bigint, coalesce(sum(amount), 0)::bigint, coalesce(sum(refunded), 0)::bigint,
         coalesce(sum(open), 0)::bigint, coalesce(sum(lost), 0)::bigint, count(*)::integer,
         coalesce((select jsonb_agg(jsonb_build_object('source', s.source, 'gross_cents', s.gross, 'raised_cents', s.net, 'count', s.n) order by s.source)
                     from (select source, sum(amount) gross, sum(net) net, count(*) n from counted group by source) s), '[]'::jsonb)
    from counted;
$$;

-- The aggregate-only view of a campaign shown to members and guests.
create function giving.campaign_public_json(c giving.campaigns)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'image_path', c.image_path,
    'image_alt', c.image_alt,
    'goal_cents', c.goal_cents,
    'raised_cents', t.raised_cents,
    'percent', least(100, floor(t.raised_cents * 100.0 / c.goal_cents))::integer,
    'goal_reached', t.raised_cents >= c.goal_cents,
    'status', c.status,
    'visibility', c.visibility,
    'accepting_gifts', giving.campaign_open(c) and f.active,
    'starts_on', c.starts_on,
    'ends_on', c.ends_on,
    'fund_id', c.fund_id,
    'fund_name', f.name
  )
  from giving.campaign_totals(c.id, giving.current_livemode()) t
  cross join giving.funds f
  where f.id = c.fund_id;
$$;

-- ---------------------------------------------------------------------------
-- Attribution triggers
-- ---------------------------------------------------------------------------
-- Commitments inherit the campaign from the intent they were created from.
create function giving.commitment_campaign_inherit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.campaign_id is null and new.intent_id is not null then
    select i.campaign_id into new.campaign_id from giving.intents i where i.id = new.intent_id;
  end if;
  return new;
end;
$$;

-- Payments inherit the campaign when the row is created:
-- * a one-time online gift, from its intent (validated at checkout);
-- * a recurring installment, from its commitment, but only while the
--   campaign is still published and not past its end date, so a recurring
--   gift keeps posting to the fund after the campaign closes without
--   moving a closed campaign's total;
-- * a manual correction, from the gift it replaces.
-- A campaign gift must post to the campaign's fund.
create function giving.payment_campaign_inherit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c giving.campaigns;
begin
  if new.campaign_id is null then
    if new.commitment_id is not null then
      select k.* into c
        from giving.commitments m join giving.campaigns k on k.id = m.campaign_id
       where m.id = new.commitment_id;
      if c.id is not null and c.status = 'published'
         and (c.ends_on is null or c.ends_on >= (coalesce(new.received_at, now()) at time zone giving.church_tz())::date) then
        new.campaign_id := c.id;
      end if;
    elsif new.intent_id is not null then
      select i.campaign_id into new.campaign_id from giving.intents i where i.id = new.intent_id;
    elsif new.replaces_payment_id is not null then
      select x.campaign_id into new.campaign_id from giving.payments x where x.id = new.replaces_payment_id;
    end if;
  end if;
  if new.campaign_id is not null
     and not exists (select 1 from giving.campaigns k where k.id = new.campaign_id and k.fund_id = new.fund_id) then
    raise exception 'This gift belongs to a campaign, so it must stay in the campaign''s fund.' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Attribution never changes after a row exists (no backfill, no moves).
create function giving.campaign_attribution_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A gift''s campaign can''t be changed once it is recorded.' using errcode = '22023';
end;
$$;

create trigger commitments_campaign_inherit before insert on giving.commitments
  for each row execute function giving.commitment_campaign_inherit();
create trigger payments_campaign_inherit before insert on giving.payments
  for each row execute function giving.payment_campaign_inherit();
create trigger intents_campaign_immutable before update on giving.intents
  for each row when (old.campaign_id is distinct from new.campaign_id) execute function giving.campaign_attribution_immutable();
create trigger commitments_campaign_immutable before update on giving.commitments
  for each row when (old.campaign_id is distinct from new.campaign_id) execute function giving.campaign_attribution_immutable();
create trigger payments_campaign_immutable before update on giving.payments
  for each row when (old.campaign_id is distinct from new.campaign_id) execute function giving.campaign_attribution_immutable();

-- ---------------------------------------------------------------------------
-- Checkout: optional campaign_id (replaces the Phase 3 body; same signature)
-- ---------------------------------------------------------------------------
create or replace function giving.op_checkout_prepare(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s giving.settings;
  f giving.funds;
  i giving.intents;
  c giving.campaigns;
  v_amount integer := (v ->> 'amount_cents')::integer;
  v_freq giving.frequency := (v ->> 'frequency')::giving.frequency;
  v_profile uuid := nullif(v ->> 'profile_id', '')::uuid;
  v_campaign uuid := nullif(v ->> 'campaign_id', '')::uuid;
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
  if v_campaign is not null then
    select * into c from giving.campaigns where id = v_campaign;
    if not found or not giving.campaign_open(c)
       or (c.visibility = 'members'
           and not exists (select 1 from public.profiles where id = v_profile and membership_status = 'approved')) then
      raise exception 'This campaign isn''t accepting gifts right now.' using errcode = '22023';
    end if;
    if c.fund_id <> f.id then
      raise exception 'Gifts to this campaign go to its own fund. Please reload the page and try again.' using errcode = '22023';
    end if;
  end if;

  insert into giving.intents (idempotency_key, profile_id, fund_id, amount_cents, frequency, campaign_id)
  values (v ->> 'idempotency_key', v_profile, f.id, v_amount, v_freq, v_campaign)
  on conflict (idempotency_key) do nothing
  returning * into i;

  if i.id is null then
    select * into i from giving.intents where idempotency_key = v ->> 'idempotency_key';
    if i.profile_id is distinct from v_profile or i.fund_id <> f.id or i.amount_cents <> v_amount or i.frequency <> v_freq
       or i.campaign_id is distinct from v_campaign then
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
    'campaign_id', i.campaign_id,
    'customer_id', (select stripe_customer_id from giving.customers where profile_id = v_profile and not livemode),
    'profile_email', (select nullif(email, '') from public.profiles where id = v_profile)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public and member reads (aggregates only)
-- ---------------------------------------------------------------------------
create function public.giving_campaigns()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(giving.campaign_public_json(c)
                            order by (c.status = 'published') desc, c.ends_on nulls last, c.published_at desc nulls last, c.id), '[]'::jsonb)
    from (select * from giving.campaigns k
           where giving.campaign_visible(k)
           order by (k.status = 'published') desc, k.closed_at desc nulls first
           limit 50) c;
$$;

create function public.giving_campaign(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select giving.campaign_public_json(c) from giving.campaigns c where c.id = p_id and giving.campaign_visible(c);
$$;

-- ---------------------------------------------------------------------------
-- Finance reads
-- ---------------------------------------------------------------------------
create function giving.campaign_admin_json(c giving.campaigns)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(c) - 'created_by' - 'updated_by' || jsonb_build_object(
    'fund_name', f.name,
    'fund_active', f.active,
    'accepting_gifts', giving.campaign_open(c) and f.active,
    'livemode', giving.current_livemode(),
    'raised_cents', t.raised_cents,
    'gross_cents', t.gross_cents,
    'refunded_cents', t.refunded_cents,
    'disputed_open_cents', t.disputed_open_cents,
    'disputed_lost_cents', t.disputed_lost_cents,
    'gift_count', t.gift_count,
    'by_source', t.by_source,
    'percent', least(100, floor(t.raised_cents * 100.0 / c.goal_cents))::integer,
    'goal_reached', t.raised_cents >= c.goal_cents
  )
  from giving.campaign_totals(c.id, giving.current_livemode()) t
  cross join giving.funds f
  where f.id = c.fund_id;
$$;

create function public.finance_campaigns()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform giving.require('finance.view');
  return coalesce((
    select jsonb_agg(giving.campaign_admin_json(c)
                     order by array_position(array['published', 'draft', 'closed', 'archived'], c.status), c.created_at desc)
    from giving.campaigns c), '[]'::jsonb);
end;
$$;

create function public.finance_campaign(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c giving.campaigns;
begin
  perform giving.require('finance.view');
  select * into c from giving.campaigns where id = p_id;
  if not found then
    return null;
  end if;
  return giving.campaign_admin_json(c) || jsonb_build_object(
    'pending_count', (select count(*) from giving.payments p
                       where p.campaign_id = c.id and p.status = 'pending' and p.livemode = giving.current_livemode()),
    'active_commitments', (select count(*) from giving.commitments m
                            where m.campaign_id = c.id and m.status in ('active', 'trialing', 'past_due') and m.livemode = giving.current_livemode()),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'details', a.details,
                                                            'actor', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = a.actor_id))
                                          order by a.created_at)
                         from public.audit_log a where a.target_type = 'campaign' and a.target_id = c.id::text), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Finance writes (finance.manage), audited by action, id, and field names
-- ---------------------------------------------------------------------------
create function public.finance_campaign_save(
  p_id uuid, p_title text, p_description text, p_goal_cents bigint, p_starts_on date, p_ends_on date,
  p_fund uuid, p_visibility text, p_image_path text, p_image_alt text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := giving.require('finance.manage');
  o giving.campaigns;
  n giving.campaigns;
  v_fields text[];
begin
  if nullif(btrim(p_title), '') is null then
    raise exception 'Enter a campaign title.' using errcode = '22023';
  end if;
  if p_goal_cents is null or p_goal_cents < 100 or p_goal_cents > 1000000000 then
    raise exception 'Enter a goal between $1.00 and $10,000,000.00.' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_starts_on is not null and p_ends_on < p_starts_on then
    raise exception 'The end date must be on or after the start date.' using errcode = '22023';
  end if;
  if p_visibility not in ('public', 'members') then
    raise exception 'Choose who can see the campaign.' using errcode = '22023';
  end if;
  if not exists (select 1 from giving.funds where id = p_fund) then
    raise exception 'Choose a fund.' using errcode = '22023';
  end if;

  if p_id is null then
    if not exists (select 1 from giving.funds where id = p_fund and active) then
      raise exception 'Choose an active fund.' using errcode = '22023';
    end if;
    insert into giving.campaigns (title, description, goal_cents, starts_on, ends_on, fund_id, visibility, image_path, image_alt, created_by, updated_by)
    values (btrim(p_title), nullif(btrim(p_description), ''), p_goal_cents, p_starts_on, p_ends_on, p_fund, p_visibility,
            nullif(btrim(p_image_path), ''), nullif(btrim(p_image_alt), ''), v_actor, v_actor)
    returning * into n;
    perform giving.audit('finance.campaign_created', 'campaign', n.id::text);
    return n.id;
  end if;

  select * into o from giving.campaigns where id = p_id for update;
  if not found then
    raise exception 'Campaign not found.' using errcode = 'P0002';
  end if;
  if o.status = 'archived' then
    raise exception 'Archived campaigns can''t be edited. Restore it first.' using errcode = '22023';
  end if;
  -- The fund is fixed once a campaign has been published (or has any gift),
  -- so every gift to a campaign stays in one fund.
  if p_fund <> o.fund_id and (o.status <> 'draft' or o.published_at is not null
                              or exists (select 1 from giving.intents where campaign_id = o.id)
                              or exists (select 1 from giving.payments where campaign_id = o.id)) then
    raise exception 'The fund can''t be changed after a campaign has been published.' using errcode = '22023';
  end if;
  update giving.campaigns
     set title = btrim(p_title),
         description = nullif(btrim(p_description), ''),
         goal_cents = p_goal_cents,
         starts_on = p_starts_on,
         ends_on = p_ends_on,
         fund_id = p_fund,
         visibility = p_visibility,
         image_path = nullif(btrim(p_image_path), ''),
         image_alt = nullif(btrim(p_image_alt), ''),
         updated_by = v_actor
   where id = p_id
  returning * into n;
  select coalesce(array_agg(x.key order by x.key), '{}') into v_fields
    from jsonb_each(to_jsonb(n)) x join jsonb_each(to_jsonb(o)) y using (key)
   where x.value is distinct from y.value and x.key not in ('updated_at', 'updated_by');
  if cardinality(v_fields) > 0 then
    perform giving.audit('finance.campaign_updated', 'campaign', n.id::text, jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return n.id;
exception when check_violation then
  raise exception 'Check the campaign details: the title is required, the image must be a processed upload, and the dates must be in order.'
    using errcode = '22023';
end;
$$;

-- Lifecycle:
--   draft     -> published | archived
--   published -> closed
--   closed    -> published (reopen) | archived
--   archived  -> closed (restore)
-- Nothing is deleted; a campaign with gifts keeps its attribution forever.
create function public.finance_campaign_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := giving.require('finance.manage');
  c giving.campaigns;
begin
  select * into c from giving.campaigns where id = p_id for update;
  if not found then
    raise exception 'Campaign not found.' using errcode = 'P0002';
  end if;
  if not (
    (c.status = 'draft' and p_status in ('published', 'archived'))
    or (c.status = 'published' and p_status = 'closed')
    or (c.status = 'closed' and p_status in ('published', 'archived'))
    or (c.status = 'archived' and p_status = 'closed')
  ) then
    raise exception 'A % campaign can''t be moved to %.', c.status, coalesce(p_status, 'that status') using errcode = '22023';
  end if;
  if p_status = 'published' then
    if not exists (select 1 from giving.funds where id = c.fund_id and active) then
      raise exception 'The campaign''s fund is archived. Restore the fund before publishing.' using errcode = '22023';
    end if;
    if c.ends_on is not null and c.ends_on < giving.church_today() then
      raise exception 'The end date has passed. Change it before publishing.' using errcode = '22023';
    end if;
  end if;
  update giving.campaigns
     set status = p_status,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
         closed_at = case when p_status = 'closed' and c.status = 'published' then now() when p_status = 'published' then null else closed_at end,
         archived_at = case when p_status = 'archived' then now() when c.status = 'archived' then null else archived_at end,
         updated_by = v_actor
   where id = p_id;
  perform giving.audit('finance.campaign_status', 'campaign', p_id::text, jsonb_build_object('from', c.status, 'to', p_status));
end;
$$;

-- Offline (cash/check) gifts toward a campaign. Same rules and idempotency
-- as finance_record_manual; the fund is the campaign's fund. Allowed while
-- the campaign is published or closed (a check can arrive after the close),
-- never for drafts or archived campaigns. Corrections made later through
-- finance_correct_manual keep the campaign (inherited from the replaced gift).
create function public.finance_record_campaign_gift(
  p_token uuid, p_campaign uuid, p_profile uuid, p_donor_name text, p_received_on date, p_amount_cents integer,
  p_method text, p_check_reference text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := giving.require('finance.record');
  c giving.campaigns;
  f giving.funds;
  p giving.payments;
begin
  perform pg_advisory_xact_lock(hashtext('the-gathering:manual-gift:' || p_token::text));
  select * into p from giving.payments where manual_token = p_token;
  if found then
    return jsonb_build_object('payment_id', p.id, 'duplicate', true);
  end if;
  select * into c from giving.campaigns where id = p_campaign;
  if not found or c.status not in ('published', 'closed') then
    raise exception 'Choose a published or closed campaign.' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000 then
    raise exception 'Enter an amount between $0.01 and $1,000,000.00.' using errcode = '22023';
  end if;
  if p_received_on is null or p_received_on > giving.church_today() or p_received_on < date '2000-01-01' then
    raise exception 'Enter the date the gift was received (not in the future).' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'check') then
    raise exception 'Choose cash or check.' using errcode = '22023';
  end if;
  if p_profile is not null and not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'Donor not found.' using errcode = 'P0002';
  end if;
  select * into f from giving.funds where id = c.fund_id;

  insert into giving.payments (
    source, status, profile_id, donor_name, fund_id, fund_name, amount_cents, received_on, received_at,
    check_reference, internal_note, recorded_by, manual_token, fee_status, campaign_id
  )
  values (
    p_method::giving.payment_source, 'succeeded', p_profile, nullif(btrim(p_donor_name), ''), f.id, f.name, p_amount_cents,
    p_received_on, giving.manual_received_at(p_received_on),
    case when p_method = 'check' then nullif(btrim(p_check_reference), '') end, nullif(btrim(p_note), ''),
    v_actor, p_token, 'not_applicable', c.id
  )
  returning * into p;
  perform giving.audit('finance.manual_recorded', 'payment', p.id::text, jsonb_build_object('method', p_method, 'campaign', c.id));
  perform giving.audit('finance.campaign_gift_recorded', 'campaign', c.id::text, jsonb_build_object('payment', p.id, 'method', p_method));
  return jsonb_build_object('payment_id', p.id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Campaign images: private bucket, readable while the image belongs to a
-- campaign the caller can see (or by finance viewers). The app re-encodes
-- uploads to WebP without metadata before storing them.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-images', 'campaign-images', false, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.can_view_campaign_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.has_capability('finance.view'))
      or exists (select 1 from giving.campaigns c where c.image_path = p_name and giving.campaign_visible(c));
$$;

create policy "Campaign images follow campaign visibility"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'campaign-images' and (select public.can_view_campaign_image(storage.objects.name)));

create policy "Finance managers upload campaign images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'campaign-images' and (select public.has_capability('finance.manage')));

create policy "Finance managers delete campaign images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'campaign-images' and (select public.has_capability('finance.manage')));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema giving from public, anon, authenticated, service_role;
revoke execute on all functions in schema giving from public, anon, authenticated, service_role;

revoke execute on function
  public.giving_campaigns(),
  public.giving_campaign(uuid),
  public.can_view_campaign_image(text),
  public.finance_campaigns(),
  public.finance_campaign(uuid),
  public.finance_campaign_save(uuid, text, text, bigint, date, date, uuid, text, text, text),
  public.finance_campaign_status(uuid, text),
  public.finance_record_campaign_gift(uuid, uuid, uuid, text, date, integer, text, text, text)
from public, anon, authenticated, service_role;

-- Reviewed anonymous entry points (tests/db/grants.test.ts): the public
-- campaign list/detail apply their own visibility rules and return
-- aggregates only; the image check is used by the storage policy above.
grant execute on function
  public.giving_campaigns(),
  public.giving_campaign(uuid),
  public.can_view_campaign_image(text)
to anon, authenticated;

grant execute on function
  public.finance_campaigns(),
  public.finance_campaign(uuid),
  public.finance_campaign_save(uuid, text, text, bigint, date, date, uuid, text, text, text),
  public.finance_campaign_status(uuid, text),
  public.finance_record_campaign_gift(uuid, uuid, uuid, text, date, integer, text, text, text)
to authenticated;
