# Cloudflare Turnstile (CAPTCHA) for sign-up and sign-in

Status: **live in production since 2026-10-24.** Supabase CAPTCHA enforcement is on, and sign-in on `https://www.gathering.church` works with the widget (owner check). See [Current state](#current-state) for what that means for previews.

## Current state

| Item | State (2026-10-24) |
| --- | --- |
| Code | Merged in [#79](https://github.com/cmingus710/The-Gathering/pull/79) |
| Supabase CAPTCHA enforcement | **On** (Cloudflare Turnstile) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in Vercel | **Production only**. Not set for Preview |
| Production | Widget appears and sign-in works on `www.gathering.church` |
| Per-deployment URLs (`the-gathering-<hash>-paint-by-number.vercel.app`) | Widget shows "isn't set up for this web address" (Cloudflare `110200`), so email sign-in fails there. Use `www.gathering.church` |
| Previews | Built without the site key, so no widget and no token: **email sign-up, sign-in, resend, and forgot password fail on previews**. Google/Apple still work. To test email auth on a preview, add the site key for Preview (or for one branch), add that branch URL to the widget's hostnames, and redeploy |

## What is protected, and how

The browser shows a Cloudflare Turnstile widget on the email forms. The widget produces a one-time token. The Server Action passes it to Supabase Auth as `captchaToken`, and **Supabase verifies it with Cloudflare** using the secret in its CAPTCHA settings. The app never sees the secret and never decides whether a token is good, so skipping the widget or posting straight to Supabase doesn't get around it.

| Flow | Form / code | Supabase call | Token |
| --- | --- | --- | --- |
| Create account | `/sign-up` → `signUpAction` | `auth.signUp` (`POST /signup`) | **Required** when enforced |
| Sign in with email | `/sign-in` → `signInAction` | `auth.signInWithPassword` (`POST /token?grant_type=password`) | **Required** |
| Resend verification link | `/sign-in` (unverified email) → `resendVerificationAction` | `auth.resend` (`POST /resend`) | **Required** |
| Forgot password | `/forgot-password` → `forgotPasswordAction` | `auth.resetPasswordForEmail` (`POST /recover`) | **Required** |
| Continue with Google / Apple | `startOAuthAction`, `/auth/callback` | `signInWithOAuth` (`GET /authorize`), `exchangeCodeForSession` (`POST /token?grant_type=pkce`) | Not checked. Supabase skips CAPTCHA on `/authorize` and on the `pkce`, `refresh_token`, and `id_token` grants |
| Email link (confirm, reset) | `/auth/confirm` | `verifyOtp` (`POST /verify`) | Not checked |
| Set a new password | `/reset-password` → `resetPasswordAction` | `updateUser` (`PUT /user`, signed in) | Not checked |
| Staying signed in | `src/proxy.ts`, every request | `getClaims` (refreshes the session when needed) | Not checked, so existing sessions are unaffected |

The endpoint list comes from Supabase Auth's router (`verifyCaptcha` on `/signup`, `/token`, `/recover`, `/resend`, `/otp`, `/magiclink`, `/sso`; `isIgnoreCaptchaRoute` exempts the `pkce`, `refresh_token`, and `id_token` grants). The local check below confirmed it.

Nothing about membership changes. A new account is still unconfirmed until the email link, still `pending` until an administrator approves it, and Google/Apple accounts still get the same pending profile.

### In the browser

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` turns the widget on. **When it's unset, no widget renders, no Cloudflare script loads, and the forms behave exactly as before.**
- The script is `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` (loaded once, on the auth pages only). The site has no Content-Security-Policy, so nothing else needs allowing. If a CSP is added later, allow `https://challenges.cloudflare.com` in `script-src` and `frame-src`.
- Widget: managed mode, `size: flexible` (fills the form width), light or dark to match the member's theme setting, its own keyboard-operable checkbox when Cloudflare asks for one.
- While a check is running, the submit button waits (for at most 20 seconds). After that, or if the check fails or the script can't load, the button is available again and Supabase decides. That way a slow check never locks anyone out before enforcement is on.
- Messages (in a polite live region under the widget, with a "Try the security check again" button):
  - script blocked or offline: "The security check couldn't load. Check your connection or any content blocker, then try again."
  - token expired: "The security check expired and is refreshing." (Turnstile refreshes it itself)
  - failed challenge (`300xxx`, `600xxx`): "…couldn't confirm this browser. Please try again, or try another browser."
  - hostname or site key not configured (`110200`, `1101xx`): "…isn't set up for this web address yet. Please contact the church office."
  - interactive check timed out: "The security check timed out. Please try again."
- Server responses (`src/lib/auth/captcha.ts`):
  - Supabase `captcha_failed` (missing, spent, expired, or invalid token): "We couldn't confirm the security check. Please complete it again, then resubmit."
  - Supabase couldn't reach Cloudflare (500): "The security check service didn't respond…"
  - Resend and forgot-password otherwise hide errors so they don't reveal which emails have accounts. A CAPTCHA rejection says nothing about the account, so it's shown instead of a false "check your email".
- Tokens are single-use. After every server response the widget fetches a new one.
- Name, email, and the `next` page are kept after any error. Passwords and the token are never echoed back.

## Cloudflare (Turnstile widget)

Cloudflare dashboard → **Turnstile** → **Add widget**:

| Setting | Value |
| --- | --- |
| Widget name | `The Gathering – sign-in` |
| Hostnames | `gathering.church`, `www.gathering.church`, `the-gathering-five.vercel.app`, and the exact preview branch hostname you test on (see below) |
| Widget mode | **Managed** |
| Pre-clearance | No |

Copy the **Site key** (public) and **Secret key** (private).

**Preview hostnames.** Supabase holds one secret for the whole project, and the previews use the production Supabase project, so Preview and Production **must use the same widget**. Preview deployments are only valid on hostnames listed on that widget. Add the stable branch URL of the branch you are testing, copied exactly from the Vercel bot comment on the PR (for this PR it's expected to be `the-gathering-git-claude-youthful-volta-txjv57-paint-by-number.vercel.app`). Don't add `vercel.app` itself, which would let any Vercel site use the key. The free plan allows 10 hostnames, so remove branch hostnames you no longer need. Per-deployment `the-gathering-<hash>-…` URLs won't work unless listed. On an unlisted host the widget shows the "isn't set up for this web address" message, and after enforcement email sign-in there will fail.

**Local development.** Don't add `localhost` to the production widget. Use Cloudflare's test keys locally: site key `1x00000000000000000000AA` (always passes) or `2x00000000000000000000AB` (always fails), or leave the variable unset.

## Vercel

| Variable | Preview | Production | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Site key (step 1: scoped to branch `claude/youthful-volta-txjv57`; step 2: all Preview branches) | Site key (step 2) | Public, not sensitive. Inlined at **build** time, so redeploy after setting or changing it |

The **secret key never goes into Vercel**, `.env` files, or the repository. It goes only into Supabase.

## Supabase

Dashboard → project `ymuiutwdnhxdqsetnwkt` → **Authentication → Attack Protection** (`/dashboard/project/ymuiutwdnhxdqsetnwkt/auth/protection`; older dashboards call the section "Bot and Abuse Protection"):

- **Enable CAPTCHA protection:** ON (only at step 3)
- **CAPTCHA provider:** Cloudflare Turnstile
- **CAPTCHA secret:** the Turnstile secret key
- Save

This applies immediately to **every** client of the project: Production, all Previews, and anything else that calls the email/password endpoints. Turning the toggle off rolls it back immediately. Requests made with the secret/service-role key, such as `scripts/bootstrap-super-admin.mjs`, are exempt.

## Rollout

Done on 2026-10-24. The steps below are kept as the record and for a repeat (for example a new widget or a key rotation).

Because Preview and Production share one Supabase project, enforcement can't be tried on Preview alone. Enforcement must wait until Production already sends tokens.

1. **Preview, enforcement off (UI check).**
   1. Create the Turnstile widget (above) with the production hostnames and this PR's branch hostname.
   2. In Vercel, add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for **Preview**, scoped to branch `claude/youthful-volta-txjv57`, then redeploy the branch (Deployments → latest preview → Redeploy, or push a commit).
   3. On the branch URL, with a test address you control: the widget appears on sign-up, sign-in, forgot password, and the resend form (sign in with an unverified address); sign-up reaches "check your email" and the email arrives; the link confirms; sign-in works; forgot password sends the email; Google still works. Check light and dark themes, phone width, and keyboard only (Tab to the widget, Space to tick it if it asks, Enter to submit). Supabase ignores the token at this point, so these confirm the UI, not enforcement.
   4. Optional: in an ad-blocking browser, block `challenges.cloudflare.com` and confirm the "couldn't load" message and retry button.
2. **Production, enforcement off.**
   1. Add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for **Production** and for **all Preview** branches **before** merging, so the merge build includes it.
   2. Merge the PR. After the production deploy, on `https://www.gathering.church/sign-in` the widget appears and completes, and sign-in works.
   3. Leave it like this for a short while (a day is plenty) and watch for "isn't set up for this web address" reports or Turnstile analytics errors.
3. **Enable enforcement** (Supabase, above). Then right away:
   1. Production sign-in, sign-up, forgot password, and Google sign-in work in a normal browser.
   2. Direct requests are rejected. Using the publishable key (safe to use here):
      ```sh
      URL=https://ymuiutwdnhxdqsetnwkt.supabase.co/auth/v1
      KEY=<NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>
      # missing token -> 400 {"error_code":"captcha_failed", ... "no captcha_token found"}
      curl -s "$URL/signup" -H "apikey: $KEY" -H 'content-type: application/json' \
        -d '{"email":"captcha-probe@example.com","password":"Probe-12345"}'
      # invalid token -> 400 {"error_code":"captcha_failed", ... "(invalid-input-response)"}
      curl -s "$URL/signup" -H "apikey: $KEY" -H 'content-type: application/json' \
        -d '{"email":"captcha-probe@example.com","password":"Probe-12345","gotrue_meta_security":{"captcha_token":"not-a-real-token"}}'
      ```
      Neither creates an account (Authentication → Users shows no `captcha-probe@` user).
   3. Members who were already signed in stay signed in.
4. **Rollback:** turn off "Enable CAPTCHA protection" in Supabase. This takes effect immediately, and the widget can stay (tokens are ignored). Removing the site key needs a redeploy.

After step 3, previews built without the site key, or on hostnames not on the widget, can't use email sign-in or sign-up. Google/Apple still work there.

## Verification done before enforcement (local)

Run on 2026-10-24 against Supabase Auth built from source (`supabase/auth` at `c3348e8`) on PostgreSQL 16, with Turnstile enforcement configured, and a production build of this branch (`NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`), Chromium. The sandbox's network policy blocked `challenges.cloudflare.com`, so neither Supabase nor the browser could reach Cloudflare. Where a token was needed, the browser loaded a small stand-in for Cloudflare's script, which only exercises the app's widget handling. Real Cloudflare verification happens at rollout step 1 (widget) and step 3 (enforcement).

- **Enforcement on, direct API:** signup, password grant, `/recover`, `/resend` without a token → `400 captcha_failed`, and no user row. `/authorize?provider=google` → 302 to Google. Refresh-token grant, `GET /user`, and `PUT /user` with an existing session → 200.
- **Enforcement on, browser (25/25):**
  - With the script blocked: the "couldn't load" message and retry button appear; the retry works by keyboard; sign-up is rejected by Supabase with the clear message, name and email are kept, the password isn't echoed, and no account is created.
  - With a token: the submit button waits for it, Supabase receives it (its log shows the call to Cloudflare's `siteverify`, which the sandbox then blocked → our "service didn't respond" message), and the widget resets for a fresh token.
  - The expired, `110200`, `300030`, and timeout messages and retry work.
  - Sign-in and forgot password show the CAPTCHA rejection rather than a false success, and keep the email.
  - Google sign-in still reaches Google.
- **Enforcement off (today's hosted state), browser (8/8):** sign-up reaches "check your email" and the account stays unconfirmed; sign-in before confirming shows the resend form and the resend sends; the token-hash link confirms; sign-in sets the session and lands on `next`; forgot password sends the reset email.
- **No site key:** no widget, no requests to Cloudflare, submit buttons enabled.
- Unit tests: `src/lib/auth/captcha.test.ts`, `tests/unit/auth-captcha-actions.test.ts`.

Not covered locally: the real Cloudflare widget and `siteverify` (blocked here), and pending-membership rows (the auth-only harness had no app schema; the code path is unchanged and is covered by `tests/db/social-login.test.ts` and the membership suites).
