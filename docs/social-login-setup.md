# Google and Apple sign-in: setup

How "Continue with Google" and "Continue with Apple" work in The Gathering, and the exact manual steps to switch them on. **Nothing in this document has been applied to the live project.** Supabase, Google, Apple, and Vercel settings are unchanged until you make the changes below.

- [How it works](#how-it-works)
- [The two kinds of URL](#the-two-kinds-of-url)
- [Step 1: Google](#step-1-google)
- [Step 2: Apple](#step-2-apple-needs-a-paid-apple-developer-membership) (requires a paid Apple Developer membership)
- [Step 3: Supabase](#step-3-supabase)
- [Step 4: Vercel environment variables](#step-4-vercel-environment-variables)
- [Apple secret renewal (every 6 months)](#apple-secret-renewal-every-6-months)
- [Hosted verification](#hosted-verification)
- [Account linking behaviour](#account-linking-behaviour)
- [Button branding](#button-branding)
- [Turning it off](#turning-it-off)

## How it works

1. **Sign in** and **Create an account** show "Continue with Google" and "Continue with Apple" above the email form, separated by "or". A button appears only when its provider is switched on for that deployment (`AUTH_OAUTH_PROVIDERS`) **and** Supabase reports the provider enabled. Without both, members see email and password only, so a half-configured provider never shows a button that fails.
2. The button runs a Server Action (`startOAuthAction`) that calls Supabase's `signInWithOAuth`. This is the PKCE flow: the code verifier is stored as an httpOnly cookie on the origin the person is using.
3. The provider sends the person back to **Supabase** (provider-to-Supabase callback). Supabase then sends them to **the app** at `/auth/callback` (Supabase-to-app redirect). That route exchanges the code for a session, or explains a cancelled, expired, or failed sign-in.
4. **New accounts** are created by Supabase. The existing database trigger gives them the same profile as an email registration: **pending**, no roles. Only the display name is copied from provider data. Nothing in provider metadata (or an email domain) approves anyone or grants a role (tests: `tests/db/social-login.test.ts`).
5. If the account has no name, which is always the case for new Apple accounts (Apple's web flow never shares one), the person is asked for it at `/complete-profile` before reaching the account status page.
6. Pending and suspended accounts see only `/account-status`, exactly as before. Status is re-read from the database on every request, so approval and suspension take effect immediately.
7. Signed-in approved members can connect or disconnect Google and Apple at **Profile → Sign-in methods** (`/profile/sign-in-methods`). This uses Supabase's manual identity linking.

Code: `src/lib/auth/oauth.ts` (rules: origins, errors, unlink safety), `src/lib/auth/oauth-config.ts` (provider gating), `src/app/auth/callback/route.ts`, `src/app/(auth)/complete-profile/`, `src/app/(member)/profile/sign-in-methods/`, `src/components/auth/`.

## The two kinds of URL

These are different. Don't mix them up.

| | What it is | Exact value | Where it goes |
| --- | --- | --- | --- |
| **Provider → Supabase callback** | Where Google and Apple send the browser after consent | `https://ymuiutwdnhxdqsetnwkt.supabase.co/auth/v1/callback` | Google: *Authorized redirect URIs*. Apple: Services ID *Return URLs*. Also shown read-only in Supabase on each provider's page as "Callback URL (for OAuth)". Confirm it matches there. |
| **Supabase → app redirect** | Where Supabase sends the browser afterwards | `<app origin>/auth/callback?provider=…[&intent=link][&next=…]` | Must match Supabase → Authentication → URL Configuration → **Redirect URLs** |

The provider callback is derived from the project's API URL (`NEXT_PUBLIC_SUPABASE_URL`, project `ymuiutwdnhxdqsetnwkt`, confirmed through the Supabase connector). If you ever add a Supabase custom domain, the callback changes to `https://<custom-domain>/auth/v1/callback`, and you'd update Google and Apple to match.

The app origin in the Supabase-to-app redirect is chosen by `resolveAuthOrigin` from the browser's own origin, but **only** if it's one of this deployment's known origins. Otherwise the canonical site URL is used, so a forged `Host` or `Origin` header can't redirect anyone elsewhere:

| Deployment | Origins the app will use |
| --- | --- |
| Production | `NEXT_PUBLIC_SITE_URL` (`https://www.gathering.church`), `https://` + `VERCEL_PROJECT_PRODUCTION_URL`, and anything in `AUTH_ALLOWED_ORIGINS` |
| Preview | The preview's own branch URL and deployment URL (`VERCEL_BRANCH_URL`, `VERCEL_URL`). A preview never sends anyone to production |
| Local | `http://localhost:<port>` / `http://127.0.0.1:<port>` |

`next` (where to go after sign-in) is always an internal path (`safeNextPath`); absolute URLs, `//host`, backslashes, and `/auth/*` are refused.

**Redirect URL allow list.** Supabase → Authentication → URL Configuration → Redirect URLs needs to include the following entries. Production `/**` is already recorded in deployment.md, so check each one rather than assuming it's there:

```
https://www.gathering.church/**
https://the-gathering-*-paint-by-number.vercel.app/**
http://localhost:3000/**
```

The second line covers every preview, both `the-gathering-git-<branch>-paint-by-number.vercel.app` and `the-gathering-<hash>-paint-by-number.vercel.app`. In Supabase patterns `*` doesn't cross `.` or `/`, and hyphens are fine. If you want sign-in to work on the `https://the-gathering-five.vercel.app` alias too, add `https://the-gathering-five.vercel.app/**` here and set `AUTH_ALLOWED_ORIGINS=https://the-gathering-five.vercel.app` in Vercel Production. Otherwise people on that alias are sent back to `www`, where the sign-in can't finish ("That sign-in didn't finish"). `gathering.church` already redirects to `www`.

> Previews use the **production** Supabase project (see phase-12-launch.md). A Google or Apple sign-in on a preview creates a real account in production. Use only the dedicated test accounts, and decline their registrations afterwards.

## Step 1: Google

No fee. Use the church's Google account that should own this (not a personal one), at <https://console.cloud.google.com/>.

1. **Create or choose a project**, for example "The Gathering".
2. **Google Auth Platform → Branding** (formerly "OAuth consent screen"):
   - App name: `The Gathering`
   - User support email: the church office address
   - App logo: **leave empty for now.** Adding a logo requires Google's brand verification before it shows.
   - App domain → home page: `https://www.gathering.church`
   - App domain → privacy policy: a public privacy policy page. **The app doesn't have one yet.** Publish one (for example on the church website) before switching the app to "In production".
   - Authorized domains: `gathering.church` and `ymuiutwdnhxdqsetnwkt.supabase.co`
   - Developer contact: the church office address
3. **Audience:** User type **External**. Leave publishing status **Testing** while you verify. Only the test users you list there can sign in, which is right for the pilot. Choose **Publish app → In production** when ready. The requested scopes (`openid`, `email`, `profile`) are non-sensitive, so no Google review is needed.
4. **Data Access → Scopes:** add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Nothing else.
5. **Clients → Create client:**
   - Application type: **Web application**, name `The Gathering (Supabase Auth)`
   - Authorized JavaScript origins: `https://www.gathering.church` (optional for this redirect flow; harmless)
   - **Authorized redirect URIs:** exactly `https://ymuiutwdnhxdqsetnwkt.supabase.co/auth/v1/callback`
   - Create, then keep the dialog open for step 3 below. Google shows the **Client secret** once, so you'll download it or copy it straight into Supabase.

**Where the Google credentials go:** only into Supabase (Step 3). Never into Vercel, the repository, chat, screenshots, or email. The client ID isn't secret; the client secret is.

## Step 2: Apple (needs a paid Apple Developer membership)

Sign in with Apple on the web requires an **Apple Developer Program** membership (an annual fee, currently US $99, or a fee waiver for eligible nonprofits). **This has not been purchased and won't be without your explicit go-ahead.** Until it exists, leave `apple` out of `AUTH_OAUTH_PROVIDERS`. The Apple button then never appears, and Google works independently.

Once you have the membership, at <https://developer.apple.com/account/resources/>:

1. **Team ID:** shown under Membership details (10 characters). Note it.
2. **App ID** (Identifiers → +, App IDs, type App): description `The Gathering`, Bundle ID (explicit) for example `church.gathering.app`. Under Capabilities tick **Sign in with Apple** (enable as a primary App ID). Leave the server-to-server notification endpoint **empty** (Supabase doesn't use it).
3. **Services ID** (Identifiers → +, Services IDs): description `The Gathering Web`, identifier for example `church.gathering.web`. **This identifier is the "Client ID" Supabase needs.** Tick **Sign in with Apple → Configure**:
   - Primary App ID: the App ID from step 2
   - **Domains and Subdomains:** `ymuiutwdnhxdqsetnwkt.supabase.co`
   - **Return URLs:** `https://ymuiutwdnhxdqsetnwkt.supabase.co/auth/v1/callback`
   - Save, Continue, Register.
4. **Signing key** (Keys → +): name `The Gathering Sign in with Apple`, tick **Sign in with Apple → Configure** with the primary App ID, then register. **Download the `AuthKey_<KEYID>.p8` file. Apple lets you download it only once.** Note the **Key ID**. Store the `.p8` in the church's password manager (not email, not a shared drive folder, not the repository).
5. **Generate the client secret.** This is a JWT signed with the `.p8`, valid for at most **6 months**. Use the generator on Supabase's Apple guide (<https://supabase.com/docs/guides/auth/social-login/auth-apple>, "Configuration"). It runs entirely in your browser, and the key doesn't leave your computer; use Chrome or Firefox, since it doesn't work in Safari. Enter the Team ID, Services ID, Key ID, and the `.p8`. Copy the resulting secret straight into Supabase (Step 3). Note the expiry date it shows.
6. **Private relay email (important for Hide My Email members).** Certificates, IDs & Profiles → Services → **Sign in with Apple for Email Communication → Configure**. Register the domain and the exact sending address the app uses (`EMAIL_FROM` in Vercel, sent through Resend). Apple only forwards mail to `@privaterelay.appleid.com` addresses from registered sources that pass SPF/DKIM checks. Without this, approval and notification emails to Apple relay addresses **bounce**. Check Apple's page for the current authentication requirements against your Resend DNS records.

**Where the Apple values go:** the Services ID and generated secret go only into Supabase. The `.p8` stays in the password manager. None of it goes into Vercel, the repository, or chat.

## Step 3: Supabase

Supabase Dashboard → project `ymuiutwdnhxdqsetnwkt` → **Authentication**:

1. **Sign In / Providers → Google:** Enable. Client IDs: the Google client ID. Client Secret: the Google client secret. Leave "Skip nonce checks" **off**. Check that the read-only Callback URL shown is `https://ymuiutwdnhxdqsetnwkt.supabase.co/auth/v1/callback`. Save.
2. **Sign In / Providers → Apple** (only after Step 2): Enable. Client IDs: the Services ID (for example `church.gathering.web`). Secret Key (for OAuth): the generated JWT. Save.
3. **Sign In / Providers → "Allow manual linking"** (under the user signup settings): **On**, if you want members to connect Google/Apple from Profile → Sign-in methods. Leave it off to skip linking; the page then shows existing methods only.
4. Leave **Allow new users to sign up** on (otherwise new Google/Apple people get "New registrations are currently closed"). Leave **Confirm email** on: email registrations still verify, and Google/Apple accounts arrive already verified by the provider.
5. **URL Configuration:** see [the allow list above](#the-two-kinds-of-url).

Supabase stores the secrets server-side; they never reach the browser. The app reads only `/auth/v1/settings` (public, publishable key) to see which providers are enabled.

> Previews and production share this Supabase project. Enabling a provider here enables it at Supabase for both. The **buttons** still appear only where Vercel's `AUTH_OAUTH_PROVIDERS` lists the provider, so turn it on for Preview first.

## Step 4: Vercel environment variables

Project `the-gathering` → Settings → Environment Variables. None of these are secrets, and none are `NEXT_PUBLIC_`.

| Variable | Value | Environments | Effect |
| --- | --- | --- | --- |
| `AUTH_OAUTH_PROVIDERS` | `google` (later `google,apple`) | **Preview first**, Production after hosted verification | Which buttons may show (each also needs Supabase enabled) |
| `AUTH_IDENTITY_LINKING` | `on` | Same as above, only if "Allow manual linking" is on in Supabase | Shows Connect/Disconnect on Profile → Sign-in methods |
| `AUTH_ALLOWED_ORIGINS` | e.g. `https://the-gathering-five.vercel.app` | Production, optional | Extra production origins sign-in may return to (each also in Supabase Redirect URLs) |

Vercel applies environment changes on the next deployment. Redeploy, or push, after changing them.

## Apple secret renewal (every 6 months)

Apple's client secret expires **at most 6 months after you generate it**. When it expires, every Apple sign-in fails with "We couldn't complete sign-in with Apple" (email/password and Google keep working). To renew:

1. Put a calendar reminder for **5 months** after each generation (with the church office as a second recipient).
2. Take the `.p8`, Team ID, Key ID, and Services ID from the password manager.
3. Generate a new secret (Step 2.5) and paste it into Supabase → Apple → Secret Key. Save. No app deployment is needed.
4. Sign in once with the Apple test account to confirm, and record the new expiry date.

If the `.p8` is lost or exposed: Apple Developer → Keys → **Revoke** it, create a new key (Step 2.4), and generate a new secret. If the **Google** client secret is exposed: Google Auth Platform → Clients → the client → add a new secret, update Supabase, then delete the old secret.

## Hosted verification

Do this on a protected **preview** of this branch, with `AUTH_OAUTH_PROVIDERS` set for Preview, using **dedicated test accounts only**: a test Google account and a test Apple ID. Add the Google test account as a test user while the Google app is in Testing.

> **Approval alerts on previews.** Email registrations made on a preview are tagged as tests, so their membership approval alert ([membership-approval-alerts.md](membership-approval-alerts.md)) never reaches production recipients. A Google or Apple sign-in can't carry that tag: Supabase creates the account before the app sees it. So a **new** Google/Apple test account on a preview queues a **real** alert to the configured recipients. Before the hosted test, either tell the recipients to expect "[TEST]" registrations, or turn alerts off under Church settings → Membership approval notifications and back on afterwards. Apple accounts are alerted before the name step, so their alert says "Name not provided".

| # | Check | Expected |
| --- | --- | --- |
| 1 | Sign-in page on phone and desktop | Google and Apple buttons above the email form, "or" divider; email form unchanged |
| 2 | Continue with Google (new test account) | Google consent → back on the **same preview URL** → "Thanks for registering", pending. Admin → Members → Pending shows it |
| 3 | Continue with Apple, choose **Hide My Email** (new Apple ID) | "Tell us your name" with the Hide My Email note → name saved → pending; admin list marks the relay address |
| 4 | Sign in with Apple again (same Apple ID) | No name requested again; still pending |
| 5 | Cancel at Google's account chooser / Apple's sheet | Back on sign-in with "Sign-in was cancelled" |
| 6 | Approve the Google test account, sign in with Google | Member home opens |
| 7 | Suspend it, reload | Account status: "Your access is paused" |
| 8 | Existing email test member → Profile → Sign-in methods → Continue with Google (a *different* Google test account) | "Google is connected"; sign out, Continue with Google opens the **same** member (same name, roles, household) |
| 9 | Try to connect the Google account from row 2 to a second member | "That Google account is already connected to a different account here"; nothing changed |
| 10 | Disconnect Google on the member from row 8 | Disconnected; email/password still signs in |
| 11 | Sign out after a Google sign-in | Signed-out page; `/home` asks to sign in |
| 12 | Installed PWA (iPhone home screen, Android) → Continue with Google | Provider sheet opens and returns to the app signed in. If iOS returns you to Safari instead of the installed app, sign in there; record the behaviour (see note) |
| 13 | Afterwards | Decline the test registrations and record the results in the PR |

**Installed PWA note.** Provider sign-in leaves the app's scope. On iOS, a home-screen app opens the provider in an in-app browser sheet that shares the app's cookies, which is what this flow needs. If a device opens the provider in the system browser instead, the PKCE cookie isn't there, and the person sees "That sign-in didn't finish… finish in the same browser or app you started in". Email/password always works in the installed app.

## Account linking behaviour

From Supabase's current documentation (Identity Linking guide):

- **Automatic linking.** When someone signs in with Google or Apple and Supabase finds an existing user with the **same verified email**, Supabase adds the identity to that user. No new user and no new profile is created; profile, roles, household, giving, notes, and everything else stay on the one account. To prevent pre-account takeover, Supabase removes *unconfirmed* identities from the existing user when it does this. The app adds no email-matching merge of its own.
- **Different email (including Apple Hide My Email).** Supabase creates a **new** user, so a **new pending** profile. The app never approves it. The account status page tells social-only pending accounts how to sign in their usual way and connect the provider instead. The church office should **Decline** the duplicate registration.
- **Manual linking** (Profile → Sign-in methods) attaches a provider account with any email to the signed-in member. If that provider account already belongs to someone else, Supabase refuses (`identity_already_exists`), and the page explains, without changing anything. Combining two existing accounts is a church-office task. It is never automatic.
- **Unlinking** is offered only when the member keeps a method they can use: their email and password, or another provider that is currently offered. It is re-checked on the server; Supabase also refuses to remove the last identity.
- A provider email or domain (for example `@gathering.church`) is never treated as proof of membership. Every new account is pending until an administrator approves it.
- **Super-administrator bootstrap** is unchanged and still one-time: `bootstrap_super_admin` refuses once a super admin exists (tested with Google-shaped accounts).

## Button branding

- **Google:** the standard four-colour "G" (never recoloured), "Continue with Google", Google's light theme (white `#FFFFFF`, `#747775` 1px stroke, `#1F1F1F` text) on the always-light sign-in panel, and the dark theme (`#131314`, `#8E918F`, `#E3E3E3`) on dark member pages. Font Roboto Medium where the device has it, otherwise Arial. Source: Google's Sign in with Google branding guidelines.
- **Apple:** "Continue with Apple", black style on light backgrounds and white on dark, logo and title the same colour, title about 43% of the button height (48px button, 20px title), and never smaller than the Google button. Only the corner radius follows The Gathering. Source: Apple Human Interface Guidelines → Sign in with Apple.
- **To do before a public launch:** the Apple logo in `src/components/auth/provider-logos.tsx` is the standard Apple glyph, drawn as an SVG path. Apple asks custom buttons to use the logo artwork from Apple Design Resources (<https://developer.apple.com/design/resources/>, "Sign in with Apple" logos). That download was blocked from the build environment, so swap in the official SVG when you have the membership.

## Turning it off

- **Hide the buttons:** remove the provider from `AUTH_OAUTH_PROVIDERS` in Vercel and redeploy. Linked identities stay; members sign in with email and password.
- **Stop the provider entirely:** disable it in Supabase → Sign In / Providers. Members who only ever used that provider then need another way in: "Forgot password?" sends a reset link to their account email, which lets them set a password. Check this with a test account before you rely on it. For Apple relay addresses it works only if step 2.6 is configured.
