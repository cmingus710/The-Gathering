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

The project's Vercel Deployment Protection is **Vercel Authentication for all deployments except custom domains** (`all_except_custom_domains`), so Stripe can't reach `*.vercel.app` preview URLs.

The narrowly scoped, supported solution:
- **One custom domain**, `giving-webhooks.gathering.church`, assigned to the `phase-3/giving-contributions` git branch (Settings → Domains). Custom domains are outside Vercel Authentication.
- **Only the webhook is served there.** `src/proxy.ts` returns 404 for every path except `/api/stripe/webhook` when the request host is `GIVING_WEBHOOK_HOST`. The rest of the preview stays behind Vercel Authentication on its normal URLs.
- **No bypass secret is needed**, so nothing sensitive appears in URLs or logs. Protection for the rest of the project is unchanged.

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

1. **Run the pending database script.** In the Supabase SQL editor, run `supabase/manual/2026-10-20-apply-pending.sql` once. It completes the Phase 2 households migration and the Phase 3 giving migrations, verbatim from the repository, in one transaction. The SQL connector refuses some of these statements.
2. **Create the ingest secret in the database and copy it.** In the SQL editor:
   ```sql
   insert into giving.secrets (name, value) values ('ingest', encode(extensions.gen_random_bytes(32), 'hex'))
   on conflict (name) do update set value = excluded.value, updated_at = now()
   returning value;
   ```
   Copy the returned value. Don't paste it anywhere except the next step.
3. **Vercel → the-gathering → Settings → Environment Variables:** add `GIVING_INGEST_SECRET` with that value. Use type Sensitive, environment Preview, branch `phase-3/giving-contributions`.
4. **Stripe Dashboard (test mode on), Developers → API keys:** create a restricted key with these permissions:
   - Write: Checkout Sessions, Customers, Products, Subscriptions, Refunds, Customer portal.
   - Read: PaymentIntents, Charges, Balance transactions, Invoices, Disputes, Events.

   Add it to Vercel as `STRIPE_SECRET_KEY` with the same scope as step 3.
5. **Stripe → Developers → Webhooks → Add destination (test mode):**
   - URL: `https://giving-webhooks.gathering.church/api/stripe/webhook`
   - Events: the list above
   - Then copy the signing secret into Vercel as `STRIPE_WEBHOOK_SECRET` (same scope).
6. **Stripe → Settings → Billing → Customer portal (test mode):** activate the portal. Enable "Update payment methods". You may leave subscription cancellation enabled, though the app also cancels directly. Don't enable plan switching or pause: they aren't supported by the app.
7. **Stripe → Settings → Payment methods (test mode):** keep Cards. Turn on Apple Pay and Google Pay. Stripe-hosted Checkout shows them on supported devices with no domain setup.
8. **Redeploy the branch** (or push a commit) so the new variables take effect. Then I verify the webhook host and run the hosted tests.

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
