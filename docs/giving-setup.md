# Giving setup (Stripe test mode)

Phase 3 runs on **Stripe test mode only**. Live keys are refused by the app (`src/lib/giving/config.ts`), and live-mode events are refused by the database (`giving.settings.allow_live_mode` is constrained to `false`). No real money can move.

## How it fits together

```
Donor ─► /give ─► server action ─► giving_ingest(checkout_prepare)  (validates amount, fund, frequency in the DB)
                         └─► Stripe Checkout Session (hosted) ─► donor pays on checkout.stripe.com
Stripe ─► https://giving-webhooks.gathering.church/api/stripe/webhook
           ├─ signature verified on the raw body (STRIPE_WEBHOOK_SECRET)
           ├─ event deduplicated by id (giving.stripe_events)
           ├─ object re-read from the Stripe API (state never taken from the browser)
           └─ giving_ingest(sync_*) ─► giving.* tables ─► email outbox ─► Resend
```

- **Database writes:** the app never holds a service-role key. The server writes giving state through `public.giving_ingest()`, which only accepts calls signed (HMAC-SHA256) with `GIVING_INGEST_SECRET`. The same secret is stored in the database as `giving.secrets('ingest')`. That secret can only perform the giving operations defined in migration `20261020000200`, not arbitrary database access. Requests older than 5 minutes are refused, and every operation is idempotent.
- **Reads:** members see only their own records (`my_giving*`). Finance users need an explicit `finance.*` capability (`finance_*`). The `giving` schema is not exposed by the Data API at all.

## Environment variables

| Name | Scope | Secret? | Purpose |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Preview, branch `phase-3/giving-contributions` | **Sensitive** | Stripe test key: `rk_test_…` (restricted, recommended) or `sk_test_…`. Live keys are refused. |
| `STRIPE_WEBHOOK_SECRET` | Preview, same branch | **Sensitive** | `whsec_…` from the test webhook endpoint below |
| `GIVING_INGEST_SECRET` | Preview, same branch | **Sensitive** | Random value shared with the database (step 3) |
| `GIVING_EMAIL_ALLOWLIST` | Preview | Encrypted | Comma-separated addresses that may receive test-mode giving emails. Everything else is recorded as "suppressed". **Set** to the two test accounts. |
| `GIVING_WEBHOOK_HOST` | Preview | Plain | `giving-webhooks.gathering.church`. On this host the app serves only the webhook path and returns 404 for everything else. **Set.** |
| `RESEND_API_KEY`, `EMAIL_FROM` | Preview | existing | Already configured (Phase 1) |

No `NEXT_PUBLIC_` variable is needed. The Stripe publishable key isn't used, because checkout is fully hosted.

## Webhook destination (why this design)

Stripe has to reach the webhook without logging in to anything.

- **One custom domain**, `giving-webhooks.gathering.church`, is assigned to the `phase-3/giving-contributions` git branch (Settings → Domains), so it always serves that branch's latest preview with that branch's variables.
- **Only the webhook is served there.** `src/proxy.ts` returns 404 for every path except `/api/stripe/webhook` when the request host is `GIVING_WEBHOOK_HOST`.
- **No bypass secret in any URL.** Requests are authenticated by Stripe's signature only.

**Correction (2026-10-19):** Vercel's Standard Protection (`all_except_custom_domains`) exempts only *production* custom domains. A custom domain assigned to a preview branch is still behind Vercel Authentication, so Stripe's deliveries received **401** from Vercel before reaching the app. An earlier check reported this host as reachable, but it went through a Vercel tool that bypasses protection, so it didn't prove Stripe could reach it.

**Current state:** the owner turned Vercel Authentication **off for the whole project** so Stripe can deliver. All preview URLs are now public. Members-only pages still require an approved account in the app, and `/give` can only take Stripe test payments. Options going forward:
- Turn Standard Protection back on after hosted testing (webhooks then stop reaching previews; failed events can be resent from Stripe or recovered with Reconcile).
- Use a Deployment Protection Exception for `giving-webhooks.gathering.church` only (Vercel Pro with Advanced Deployment Protection).
- Use a separate webhook-only Vercel project with protection off (not built yet).

A bypass token in the Stripe endpoint URL is ruled out, because it would expose an access credential in a URL.

**One endpoint for all previews.** Stripe is configured with this single endpoint, so only the deployment behind it processes events. Every preview shares the Supabase project, but even if two receivers existed, events are deduplicated by id and emails by a per-gift key, so nothing could be recorded or sent twice.

**Moving the destination later:** reassign the domain to another branch (or to production at release). The endpoint URL in Stripe stays the same.

### Events to subscribe (test mode)

`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `payment_intent.canceled`, `charge.succeeded`, `charge.updated`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

(The same list is `HANDLED_EVENTS` in `src/lib/giving/processor.ts`.)

### Retries and missed events

- A non-2xx response makes Stripe retry with exponential backoff: up to 3 days in live mode, and three times over a few hours in test mode. The endpoint returns:
  - 400 for a bad signature;
  - 409 while the same event is already being processed;
  - 500 on a processing failure, so Stripe retries;
  - 503 when not configured.
- Duplicate deliveries return 200 with `outcome: "duplicate"` and change nothing.
- **Reconciliation:** Admin → Giving → Reconcile & email re-reads all checkouts, recurring invoices, refunds, and disputes created in a date range (up to about 3 months), plus gifts still missing fee data, and applies them with the same idempotent operations. Run it after an outage, or any time totals look wrong.

## Setup steps (owner)

Never paste secret values into chat, issues, or commits. Copy them directly between Supabase, Stripe, and Vercel.

1. **Run the pending database script.** Open the [SQL editor for The Gathering project (`ymuiutwdnhxdqsetnwkt`)](https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new), paste [`supabase/manual/2026-10-20-apply-pending.sql`](../supabase/manual/2026-10-20-apply-pending.sql), and run it once.
   - It finishes Phase 2's `20261019000300` (`household_leave`) and Phase 3's `20261020000200` and `20261020000300`, verbatim from the repository (the SQL connector refuses some of these statements). It only creates functions and grants and records those three versions in the migration history. No existing rows change.
   - A preflight check stops with "Nothing was changed" unless the database is The Gathering's at exactly the expected stage (`20261020000100` applied, these three not yet).
   - It runs in one transaction. A failed run leaves nothing behind and can simply be rerun. A rerun after success stops at the preflight check.
2. **Create the ingest secret.** In the same SQL editor, run [`supabase/manual/2026-10-20-create-ingest-secret.sql`](../supabase/manual/2026-10-20-create-ingest-secret.sql). It is create-only:
   - If no secret exists, it creates one and shows it once. Copy it straight into step 3.
   - If one already exists, it keeps it and shows `ALREADY SET`, so rerunning setup never silently rotates the secret. Use the value already in Vercel.
   - Deliberate rotation (only if the secret leaked): update `giving.secrets` where `name = 'ingest'` with a new random value, then immediately replace `GIVING_INGEST_SECRET` in Vercel and redeploy. Until the redeploy, webhooks fail with 500 and Stripe retries them.
3. **Vercel → the-gathering → Settings → Environment Variables:** add `GIVING_INGEST_SECRET`. Use type Sensitive, environment Preview, branch `phase-3/giving-contributions`.
4. **Stripe Dashboard (test mode on), Developers → API keys → Create restricted key.** These permissions match the API calls the app makes (`src/lib/giving/checkout.ts`, `processor.ts`):

   | Resource | Access | Used for |
   | --- | --- | --- |
   | Checkout Sessions | Write | create, retrieve, list (reconcile) |
   | Prices | Write | inline `price_data` in Checkout and when changing a recurring amount |
   | Products | Write | one Stripe product per fund, created on first use |
   | Customers | Write | create and look up the donor's customer |
   | Subscriptions | Write | retrieve, change amount, cancel |
   | Customer portal | Write | billing portal sessions (update payment method) |
   | Refunds | Write | create, retrieve, list |
   | PaymentIntents | Read | payment status |
   | Charges | Read | card details and fee lookup |
   | Balance (balance transactions) | Read | Stripe fees |
   | Invoices | Read | recurring payments |
   | Disputes | Read | dispute status |

   Leave everything else at None. Events access isn't needed: webhook signatures are verified locally. Add the key to Vercel as `STRIPE_SECRET_KEY` with the same scope as step 3.
5. **Stripe → Developers → Webhooks → Add destination (test mode):**
   - URL: `https://giving-webhooks.gathering.church/api/stripe/webhook`
   - Events: the 22 listed above
   - Copy the signing secret into Vercel as `STRIPE_WEBHOOK_SECRET` (same scope).
6. **Stripe → Settings → Billing → Customer portal (test mode):** activate the portal. Enable "Update payment methods". You may leave subscription cancellation enabled, though the app also cancels directly. Don't enable plan switching or pause: they aren't supported by the app.
7. **Stripe → Settings → Payment methods (test mode):** keep Cards. Turn on Apple Pay and Google Pay. Stripe-hosted Checkout shows them on supported devices with no domain setup.
8. **Redeploy the branch** (or push a commit) so the new variables take effect. Then I verify the webhook host and run the hosted tests.

**The webhook gets the same secrets as the app.** `giving-webhooks.gathering.church` is assigned to the `phase-3/giving-contributions` branch. It serves that branch's latest Preview deployment, the same deployment as the branch's preview URL, so it uses the branch's Preview variables. Variables only apply to deployments built after they're added, so step 8 is required.

## Test and live separation (release requirements)

- **Test data stays labeled.** Every record carries `livemode`. Finance views, totals, statements, and exports show only test-mode records in this phase.
- **Before release:**
  - A reviewed migration must allow live mode.
  - Switch those views to live data.
  - Keep or archive the test rows.
- **Separate production credentials:** live Stripe keys, a new webhook endpoint and secret, and a new ingest secret. These must be stored only in the Production environment and never shared with previews. Consider a separate Supabase project for production.
- **Before members download statements:** the church's legal name, address, tax ID, and approved acknowledgment wording must be entered and approved in Admin → Giving → Settings.
- **Configuration ownership:**
  - The church owner holds the Stripe account and the Vercel and Supabase secrets.
  - Finance administrators manage funds, wording, and emails in the app.
  - Nobody else needs access to keys.

## PayPal / Venmo (future)

Not implemented, and no inactive buttons are shown. The extension point is `CheckoutProvider` in `src/lib/giving/checkout.ts`. A new provider would:
- create a hosted session from the same prepared intent (`checkout_prepare`);
- report confirmed payments through the same `giving_ingest` sync operations.

This keeps all ownership, idempotency, and email rules in one place.
