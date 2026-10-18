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
| Deployment protection | Vercel Authentication on all deployments except custom domains. Viewers must be signed in to Vercel with team access. |

### Production is paused

Until Phase 1 is reviewed, the project's **Ignored Build Step** is:

```sh
if [ "$VERCEL_ENV" = "production" ]; then echo 'Production builds paused until Phase 1 review'; exit 0; else exit 1; fi
```

Pushes and merges to `main` create a production deployment that is immediately canceled, while every other branch still builds a preview. Verified on 2026-10-18: deployment `dpl_DDEVoRXhTyqUJSLQUdCquV8G44vC` (merge of PR #1) was canceled by this step.

**Owner decision (2026-10-18):** `gathering.church` and `www.gathering.church` stay attached as Production domains during review. Custom domains are not covered by Vercel Authentication, so these addresses are **publicly reachable** and serve the current production deployment described below.

The only production deployment is `dpl_BG88jQqCsfiG4hEyAGkRgGeFonho` (commit `e0c1de3`). Vercel created it automatically when the project was first connected, before any environment variables existed. It isn't publicly reachable because of deployment protection, and it shows the "not configured" states.

**To release to production** (after review):
1. Add the Production environment variables.
2. Clear the Ignored Build Step (Settings → Git → Ignored Build Step).
3. Redeploy `main`.

## Environment variables

| Variable | Preview | Production | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ set | ☐ owner | `https://ymuiutwdnhxdqsetnwkt.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ set | ☐ owner | Publishable key; safe in the browser, RLS enforces access |
| `NEXT_PUBLIC_SITE_URL` | **do not set** | ☐ owner | Production canonical URL. Previews must use their own `VERCEL_BRANCH_URL`, so email links never jump to production |
| `RESEND_API_KEY` | ☐ optional | ☐ optional | Sensitive; server-only (approval emails) |
| `EMAIL_FROM` | ☐ optional | ☐ optional | e.g. `The Gathering <hello@verified-domain>` |
| `SUPABASE_SECRET_KEY` | never | never | Operator scripts only |

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
