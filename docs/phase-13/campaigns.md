# Phase 13 · Fundraising campaigns and progress meter

Campaigns extend the Phase 3 giving module. A campaign is a goal that gifts
can be made toward. It always posts to one existing fund, so campaign gifts
are ordinary contributions in the existing accounting (fund totals,
statements, CSV exports); the campaign is an extra, immutable attribution on
top. Operator-facing guidance is in [../finance-guide.md](../finance-guide.md#campaigns).

## Files

| Area | Files |
| --- | --- |
| Migration | `supabase/migrations/20261031000100_giving_campaigns.sql` |
| Hosted apply script | `supabase/manual/2026-10-31-apply-giving-campaigns.sql` (preflight: 20261030000100 recorded, 20261031000100 not; one transaction; records the version with `created_by = 'phase-13'`) |
| Member UI | `src/app/(giving)/give/page.tsx` (campaign list), `src/app/(giving)/give/campaigns/[id]/page.tsx`, `src/components/giving/campaign-meter.tsx`, `src/components/giving/campaign-card.tsx`, `src/app/(giving)/give/give-form.tsx` (`campaign` prop) |
| Checkout | `src/app/(giving)/actions.ts` (`campaignId`), `src/lib/giving/checkout.ts` (`campaign_id` sent to `checkout_prepare`; cancel returns to the campaign page) |
| Finance UI | `src/app/admin/finance/campaigns/` (list, detail/edit, status buttons, actions), nav entry in `finance-nav.tsx`, campaign choice in Record cash/check (`finance-forms.tsx`, `actions.ts`, `manual/page.tsx`) |
| Shared | `src/lib/giving/campaigns.ts` (types, transitions, meter text), `src/lib/giving/campaign-images.ts` (upload processing, signed URLs) |
| Tests | `tests/db/campaigns.test.ts`, `tests/db/grants.test.ts` (ANON list), `src/lib/giving/campaigns.test.ts` |

## Data model

`giving.campaigns` (private schema, RLS on, no grants, like every giving table):
`id`, `title` (1–120), `description` (≤ 2000), `image_path` / `image_alt`,
`goal_cents` ($1 – $10M), optional `starts_on` / `ends_on` (calendar dates in
the church time zone), `fund_id` (required, references `giving.funds`),
`status` (`draft | published | closed | archived`), `visibility`
(`public | members`), `published_at` / `closed_at` / `archived_at`,
`created_by` / `updated_by`, timestamps. Campaigns are addressed by id (no slug).

`campaign_id` (nullable, FK) was added to `giving.intents`,
`giving.commitments`, and `giving.payments`.

### Lifecycle (`public.finance_campaign_status`)

| From | Allowed to |
| --- | --- |
| draft | published, archived |
| published | closed |
| closed | published (reopen), archived |
| archived | closed (restore) |

Publishing requires the fund to be active and the end date (if any) not to
have passed. The fund can't change once the campaign has been published (or
has any intent or payment). Archived campaigns can't be edited. Every create,
edit (changed field names only), and status change is written through
`giving.audit` with `target_type = 'campaign'`; no amounts or donor data are
audited.

## Attribution

All in the database, like `fund_id`; Stripe metadata still carries only `gift_intent_id`.

1. **Checkout.** `giving.op_checkout_prepare` (replaced with a compatible
   body) accepts an optional `campaign_id`. It refuses unless the campaign is
   `published`, today (church time zone) is within its dates, its fund is the
   requested (active) fund, and, for `members` campaigns, the donor is a
   signed-in approved member. The intent stores `campaign_id`; reusing a form
   token with a different campaign is refused like any other changed detail.
2. **Payments and commitments inherit on insert** (trigger, `BEFORE INSERT`):
   - one-time online payment → from its intent (so a payment that confirms
     after the campaign closes, e.g. a delayed method, still counts);
   - commitment → from its intent;
   - recurring installment → from its commitment, **only while the campaign is
     published and the payment date is not after `ends_on`**; later
     installments post to the fund without the campaign, so a closed
     campaign's total doesn't keep moving;
   - manual correction → from the gift it replaces.
   A row with a campaign must be in the campaign's fund (otherwise the insert
   is refused, e.g. a correction that changes the fund).
3. **Immutable.** A `BEFORE UPDATE` trigger on all three tables refuses any
   change to `campaign_id`, including setting it on an older row. Historical
   gifts are never backfilled. Titles can change freely; attribution is by id.

### Offline gifts (approach chosen)

Cash and check gifts are attributed with the payment row itself (no separate
adjustment table): `public.finance_record_campaign_gift(p_token, p_campaign,
p_profile, p_donor_name, p_received_on, p_amount_cents, p_method,
p_check_reference, p_note)` (`finance.record`). Same validation and
form-token idempotency as `finance_record_manual`; the fund is the campaign's
fund. Allowed for `published` and `closed` campaigns (late checks), never
drafts or archived. Audited as `finance.manual_recorded` (payment) and
`finance.campaign_gift_recorded` (campaign). Corrections through
`finance_correct_manual` keep the campaign; reversals stop it counting. The
admin breakdown separates `stripe`, `cash`, and `check`; the public meter shows
only the aggregate.

## Progress definition

Computed on every read by `giving.campaign_totals(campaign_id, livemode)` from
the source rows. There are no stored counters, so concurrent or replayed
webhooks can't race or double-count, and each Stripe PaymentIntent / Invoice
is one `payments` row (unique keys + idempotent upserts).

For each row in `giving.payments` with `campaign_id = X`, `livemode = M`, and
`status = 'succeeded'`:

```
counted = greatest(amount_cents
                   - sum(refunds.amount_cents where status = 'succeeded')
                   - sum(disputes.amount_cents where status = 'lost')
                   - sum(disputes.amount_cents where status not in ('won','lost','warning_closed','prevented')),
                   0)
raised  = sum(counted)
```

- **Refunds:** only `succeeded` refunds subtract (pending/failed don't). Partial and full refunds both work; a full refund brings the gift to 0.
- **Disputes:** an **open** dispute (any status other than won / lost /
  warning_closed / prevented, including Stripe inquiries) holds its amount
  back until resolved. **Lost** subtracts permanently. **Won** (or
  warning_closed / prevented) stops subtracting, restoring the amount.
- **Never counted:** `pending`, `failed`, `canceled`, and `reversed`
  (manual) payments; commitments themselves and their future installments
  (only paid invoices exist as succeeded payments); pledges.
- **Mode:** totals are per mode and never mixed. Every reader passes
  `giving.current_livemode()` (= `giving.settings.allow_live_mode`, pinned
  false by a CHECK), so the app shows test-mode totals only; a live row
  inserted directly is invisible to all readers (tested). Manual gifts are
  recorded with `livemode = false`, so if live mode is ever enabled, manual
  campaign gifts would need a decision (see "Open items").
- **Percent** = `floor(raised * 100 / goal)`, capped at 100; `goal_reached`
  = `raised >= goal`. Gifts are still accepted after the goal is reached,
  until the campaign is closed.

## Reads

| Function | Who | Returns |
| --- | --- | --- |
| `public.giving_campaigns()` | anon, authenticated | Visible campaigns (published first, then up to the most recent closed; 50 max) |
| `public.giving_campaign(p_id)` | anon, authenticated | One visible campaign, or null |
| `public.finance_campaigns()` | `finance.view` | All campaigns with totals |
| `public.finance_campaign(p_id)` | `finance.view` | Totals, gross/refunds/disputes, breakdown by source with counts, pending count, active recurring count, history |

**Visible** = status `published` or `closed`, and `visibility = 'public'` or
the caller is an approved member (`public.is_approved_member()`). Drafts and
archived campaigns are never returned. Public fields are exactly: `id, title,
description, image_path, image_alt, goal_cents, raised_cents, percent,
goal_reached, status, visibility, accepting_gifts, starts_on, ends_on,
fund_id, fund_name`. No gift counts (they could identify donors at small n),
donor names or emails, individual amounts, or payment rows. Note that the
aggregate itself can reveal a single donor's amount when only one person has
given; that is inherent to showing a total.

### Grants

`giving_campaigns`, `giving_campaign`, and `can_view_campaign_image` were added
to the reviewed anonymous list in `tests/db/grants.test.ts`: the first two apply
their own visibility rules and return aggregates only (needed for "public"
campaigns on the guest-accessible `/give`), and the third is the storage
policy check (same pattern as `can_view_event_image`). The finance functions
are granted to `authenticated` only. Every new function revokes from
`public, anon, authenticated, service_role` first.

## Images

Private bucket `campaign-images` (WebP only, 2 MB). The app validates the
real file type and size, re-encodes to WebP at most 1600×1000, and strips
metadata (`src/lib/giving/campaign-images.ts`, same as event covers). Storage
policies: read when `public.can_view_campaign_image(name)` (finance viewers,
or the image belongs to a campaign visible to the caller); upload/delete with
`finance.manage`. Pages use short-lived signed URLs created with the viewer's
own client.

## UI

- `/give` lists visible campaigns above the general form (only when online giving is available). Each card shows the meter and links to the campaign page.
- `/give/campaigns/[id]` shows the image, meter, description, and, while accepting gifts, the existing "Testing only" notice and `GiveForm` with the campaign's fund locked and a hidden `campaignId`. Closed campaigns show the total and no give button; not-yet-open campaigns explain why.
- `CampaignMeter` is a `role="progressbar"` with `aria-valuenow` (0–100) and `aria-valuetext` like "$1,250 raised of $5,000 goal" (", goal reached" appended). At the goal it shows "Goal reached — thank you" (plus "gifts are still welcome" while open). It uses theme tokens only (`bg-primary`, `bg-success`, `bg-surface-muted`), so it follows light and dark themes, and respects reduced motion.
- Admin → Giving → Campaigns: list with status/visibility badges and meters; detail page with status buttons, totals and source breakdown, history, and the edit form (image upload/remove, alt text).

## Tests

`tests/db/campaigns.test.ts` (real database, real processor and ingest RPC,
fake Stripe) covers: authorization (member, finance viewer, and super admin
without a finance role can't save or change status; anon can't call finance
functions), lifecycle transitions and audit, validation, visibility (anon
sees only public published/closed; members-only hidden from anon and pending
accounts; drafts and archived hidden), the exact public field list (no donor
data or counts), image read checks, checkout validation (draft, closed,
future start, fund mismatch, members-only guest, token reuse), totals with
succeeded payments, duplicate and re-sent events counted once, concurrent
ingest of the same payment on three connections, failed and pending
excluded, pending→succeeded partial refund and full refund interleaved with
duplicate events, disputes open → lost / under review → won, test vs live
separation, goal reached, recurring (paid installments only, failed excluded,
no attribution after close), offline gifts (idempotent, by-source breakdown,
reversal, correction keeps the campaign, fund change refused, drafts
refused), and immutability / no backfill.

## Open items

- Live mode: manual gifts are always `livemode = false`. If live payments are ever enabled, decide whether manual campaign gifts count in live totals (and add a mode to manual entry).
- Contribution list/detail pages and member giving history don't show a gift's campaign yet (attribution is visible through the campaign's totals and breakdown only).
- Funds archived after a campaign is published make the campaign stop accepting online gifts (`accepting_gifts` false) until the fund is restored.
