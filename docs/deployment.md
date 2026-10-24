# Deployment

## Vercel project

| Setting | Value |
| --- | --- |
| Team | Paint By Number (`paint-by-number`) |
| Project | `the-gathering` (`prj_MkYLVwwJJU9aDDwQSj5vymbhd0s4`), Next.js preset |
| Git | `cmingus710/The-Gathering` |
| Production branch | `main` (confirmed: the merge of PR #1 created a production-target deployment) |
| Production domains | `the-gathering-five.vercel.app`, `www.gathering.church` (primary), `gathering.church` (308 → www) |
| Preview URLs | `the-gathering-<hash>-paint-by-number.vercel.app` per deployment; `the-gathering-git-<branch-slug>-paint-by-number.vercel.app` per branch |
| Deployment protection | Off for the whole project (the owner turned Vercel Authentication off on 2026-10-19 so Stripe could reach the webhook host). Preview URLs are publicly reachable. |

### Production is live

Released 2026-10-20 (owner decision; shared Supabase project with the previews, Stripe still in **test mode**):

1. Production environment variables added (table below).
2. Ignored Build Step cleared, so every push or merge to `main` now deploys to production.
3. `main` at `1944fd4` (Phase 9 merge) deployed as `dpl_BsNQwLjJWQsh6stmGKh7XS8QKEdT`, aliased to `www.gathering.church`, `gathering.church` (308 → www), and `the-gathering-five.vercel.app`. Checked: `/` and `/sign-in` return 200 with the configured sign-in form; `/memory` redirects to sign-in.
4. Supabase Auth Site URL set to `https://www.gathering.church`, with `https://www.gathering.church/**` added to the redirect URLs (preview entries kept).
5. Scheduler: `events.settings.job_url` moved from the Phase 7 preview to `https://www.gathering.church/api/jobs/events`. A database-signed test request returned **200** (events, community, media, prayer, and memory ticks), so production's `EVENTS_JOB_SECRET` matches `events.secrets`. Previews no longer receive scheduler requests.

**Since then (checked 2026-10-21, Phase 11):** production serves `main` at `5add6de` (the owner's brand SVG upload) as `dpl_8FFrU3WNeR5yzpMfGRzo8df4t4ky`. The hosted database already has the Phase 10 migrations, so production runs Phase 9 code on the Phase 10 schema until PR #16 is merged.

**To pause production again:** set the Ignored Build Step back to

```sh
if [ "$VERCEL_ENV" = "production" ]; then echo 'Production builds paused'; exit 0; else exit 1; fi
```

and, if needed, roll back to an earlier production deployment in Vercel.

## Environment variables

| Variable | Preview | Production | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ set | ✅ set | `https://ymuiutwdnhxdqsetnwkt.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ set | ✅ set | Publishable key; safe in the browser, RLS enforces access |
| `NEXT_PUBLIC_SITE_URL` | **do not set** | ✅ `https://www.gathering.church` | Production canonical URL. Previews must use their own `VERCEL_BRANCH_URL`, so email links never jump to production |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | — (not set) | ✅ set | Cloudflare Turnstile site key (public). Supabase CAPTCHA enforcement is **on** (2026-10-24), so previews without it can't use email sign-in or sign-up. See [turnstile-captcha.md](turnstile-captcha.md#current-state) |
| `RESEND_API_KEY` | ✅ set | ✅ set | Sensitive; server-only (approval emails) |
| `EMAIL_FROM` | ✅ set | ✅ set | e.g. `The Gathering <hello@verified-domain>` |
| `EVENTS_JOB_SECRET`, `MEDIA_RATE_SECRET` | ✅ set | ✅ set | Sensitive; same value as `events.secrets('job')` for the job secret |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GIVING_INGEST_SECRET` | Phase 3 branch | ✅ set (test mode) | Sensitive; see giving-setup.md |
| `GIVING_WEBHOOK_HOST`, `GIVING_EMAIL_ALLOWLIST` | ✅ set | — | The webhook host `giving-webhooks.gathering.church` is assigned to the `phase-3/giving-contributions` branch, so Stripe test webhooks are processed by that preview, not production |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | — | — | Not set anywhere (checked 2026-10-21), so web push is off. Setup: [notifications.md](notifications.md#web-push-optional) |
| `CRON_SECRET` | — | — | Not set (the job route's optional GET trigger is unused; the database scheduler signs POSTs) |
| `SUPABASE_SECRET_KEY` | never | never | Operator scripts only |

## What previews share with production

Every preview uses the **same** Supabase project (database, Auth users, Storage), the same Resend key and sender, and the same job secret as production, and Deployment Protection is off. So on any preview URL:

- registering creates a real production account, and approving it emails a real person;
- posting, RSVPs, prayers, and uploads land in production data and can notify real members;
- only the scheduler is production-only (`events.settings.job_url`).

Until previews are protected or moved to their own Supabase project, test on previews only with the dedicated test accounts, `[TEST]` content, and email addresses you control, and clean up afterwards. Pushing a feature branch creates only a preview; merging to `main` deploys production.

## Branch workflow

- `main` holds the reviewed history. Every change arrives through a feature branch (`phase-N/...`) and a pull request.
- Each branch push builds a preview, and the PR shows its URL. Verify on the preview, then merge.
- `claude/sweet-lamport-fsrqcc` was the original Phase 1 branch. It's fully contained in `main` and can be deleted once GitHub's default branch is switched to `main`.

## Email domain

`gathering.church` was bought through Vercel (Paint By Number team), and its DNS is hosted by Vercel.

| Record | Type | Purpose |
| --- | --- | --- |
| `resend._domainkey` | TXT | DKIM signing key for the Gathering Resend account |
| `send` | MX | Resend return-path (bounces) |
| `send` | TXT | SPF: `v=spf1 include:amazonses.com ~all` |
| `_dmarc` | TXT | `v=DMARC1; p=none;` (monitoring only) |

The domain lives in the dedicated Gathering Resend account (moved there from an older account with Resend's domain-claim process, 2026-10-18). Status: **verified** in us-east-1, TLS enforced, open/click tracking off. Sender address: `hello@gathering.church`.
