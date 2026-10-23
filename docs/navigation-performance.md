# Page-navigation latency (October 2026)

Why moving between pages felt slow on an iPhone, what was changed, and what is left. Measured on production builds only; development mode was never used as a baseline.

## How it was measured

**Production evidence (Vercel observability, production environment, 20–22 Oct 2026).** Functions run in `iad1`. Every Supabase call the server makes costs about 100–190 ms at the median (the fastest seen are 26–36 ms):

| Call (production, p50) | ms |
| --- | --- |
| `/auth/v1/user` (account check, every page) | 118 |
| `/rest/v1/profiles`, `rpc/my_capabilities` (membership, every page) | 103, 113 |
| `rest/v1/church_settings`, `rpc/community_unread_counts` (shell) | 136, 118 |
| `rpc/events_list` | 155 |
| `rpc/bible_today`, `rpc/media_home`, `rpc/memory_home_card` (Home) | 191, 181, 172 |
| `/auth/v1/.well-known/jwks.json` (fetched once per server instance) | 110 |

Function duration p75: `/home` 434 ms, `/events` 369 ms, `/community/t/[id]` 526 ms, `/api/community/unread` (badge poll) 617 ms. The JWKS fetch shows the project signs sessions with an asymmetric key, so tokens can be verified without calling Auth.

**Protected-preview overhead.** Vercel Authentication is on for every deployment except the custom domains (`ssoProtection: all_except_custom_domains`). Preview URLs therefore add a Vercel sign-in redirect on first visit and an edge check on each request; `www.gathering.church` has neither. Preview timings are not representative and were not used.

**Lab (repeatable, before and after under identical conditions).** `next build` + `next start` of `main` (`5fe1726`) and of this branch, side by side, against a local Supabase-equivalent stack (PostgreSQL 16 with all migrations, PostgREST, Supabase Auth with an ES256 signing key like hosted) holding synthetic data (44 members, 400 posts, 12 recurring event series ≈ 230 occurrences, a 90-day plan with enrolments, 12 playlists, a 60-episode show). A pass-through gateway adds **110 ms to every Supabase call** to match the production medians above. The browser is Chromium at iPhone size (390×844 @3x, touch) with **4× CPU throttling** and a 70 ms / 12 Mbps network. Each journey ran 3 times in a fresh session (median shown): a first visit (route code and data not yet loaded), Back, then the same tap again (repeat). "Feedback" is the first visible response to the tap (skeleton, spinner, or new page); "complete" is the destination's heading on screen with no loader.

## Measured causes

1. **Three to four sequential Supabase round trips before any page could render.** Every navigation did `auth.getUser()` (a network call to Auth, ~118 ms in production), *then* profile + capabilities, *then* the page's own queries; Events added a fourth wave (categories, then occurrences), and the shell layouts fetched badge counts only after the account on full loads and cross-section taps. With production latencies that is 350–600 ms of waiting per tap before the server sends anything.
2. **No feedback on tap.** Member pages had no `loading.tsx`, so dynamic routes were not prefetched and a tap did nothing visible until the whole page arrived (0.5–1.1 s in the lab). Events and Podcasts, which had one, showed feedback in 130–280 ms.
3. **The app shell was rebuilt when crossing sections.** Home, Community, and Bible live in `(member)`; Events in `(events)`; Podcasts in `(teaching)`; Give in `(giving)`. Each group rendered its own copy of the member shell, so Home → Events re-ran the shell's queries on the server and remounted the header, dock, and live-notification connection in the browser.
4. **Events sent every occurrence for four months.** The Upcoming list rendered ~170 cards: a 385 KB navigation payload (911 KB as a full page) and 1.2–1.5 s to finish on the phone profile, even when repeated.
5. **Back to the Community feed landed in the wrong place.** The feed saved its scroll position after the next page had already scrolled the window, and its Back check relied on `popstate`, which Next.js now fires after it has shown the page. Members returned to a different post (in one trace the feed was put back at 144 px instead of 1,039 px).
6. **The badge poll made three sequential calls** (`getUser`, `is_approved_member`, counts), ~600 ms each, every 60 s and on every return to the app.
7. **Shell JavaScript.** The browser Supabase client (used only for the live notification connection) was in the initial bundle on every page: Home's HTML referenced 1,002 KB of JavaScript (297 KB gzipped).

Not causes: database time is small next to the round trips (the slowest home RPCs add 60–90 ms over a trivial call in production and run in parallel), images are pre-sized WebP, and Music already lazy-loads all but the first Spotify player.

## Fixes

| Change | Where |
| --- | --- |
| Verify the session with `getClaims()` (local signature check against the cached JWKS) instead of `getUser()`; profile, status, and capabilities are still read from the database on every request | `src/lib/auth/viewer.ts` |
| Start page queries alongside the member check (all are read-only `STABLE` functions behind RLS; nothing renders until the check passes) | Home, Community, post, Bible, Events, event, Podcasts, Music, Books, Saved, Gallery pages |
| One shared shell: `(member)`, `(events)`, `(teaching)`, `(giving)` now sit under `src/app/(app)`, whose layout renders the member shell once for approved adults (badge counts fetched in parallel with the account). Section layouts keep their own checks and their visitor/youth chrome | `src/app/(app)/layout.tsx` and the four group layouts |
| Skeleton `loading.tsx` for each member section (prefetched with the links to it), the Community feed, and event detail; a spinner on a tapped post title and a lit dock tab while Home loads (`useLinkStatus`) | `src/components/layout/section-loading.tsx`, `src/components/ui/page-skeleton.tsx`, `link-pending.tsx`, `member-nav.tsx` |
| Events Upcoming shows the next 30 occurrences with "Show more events"; categories and occurrences load in parallel | `src/app/(app)/(events)/events/page.tsx` |
| Feed position: save the position at the tap, restore when the feed is shown again on the same history entry (Navigation API, `popstate` fallback), and pause scroll anchoring while posts settle | `src/components/community/feed.tsx` |
| Badge poll: `getClaims()` and the approval check run in parallel with the count query (403 still reloads a suspended member) | `src/app/api/community/unread/route.ts` |
| Load the browser Supabase client after the page is interactive | `src/components/community/realtime-provider.tsx` |

Home deliberately has no loading skeleton: a Suspense boundary makes React hold streamed content back for at least 300 ms after the placeholder paints, which on Home (the launch screen) delayed the first meaningful paint by ~400 ms in the lab. The dock tab lights up instead.

No index was added: no query showed a plan or time problem that an index would fix, and the evidence points at round trips, not query time.

## Before and after (lab, median of 3, ms)

Taps from Home (feedback / complete):

| Journey | Before | After |
| --- | --- | --- |
| Community, first visit | 1086 / 1149 | 142 / 807 |
| Community, repeat | 645 / 681 | 87 / 455 |
| Events, first visit | 284 / 1500 | 144 / 550 |
| Events, repeat | 135 / 1195 | 102 / 478 |
| Bible, first visit | 627 / 651 | 160 / 484 |
| Bible, repeat | 529 / 547 | 121 / 433 |
| Music, first visit | 573 / 606 | 145 / 528 |
| Music, repeat | 495 / 528 | 93 / 477 |
| Podcasts, first visit | 200 / 616 | 145 / 514 |
| Podcasts, repeat | 121 / 500 | 57 / 392 |
| Back to Home (any of the above) | 123–201 | 133–152 |

Detail pages:

| Journey | Before | After |
| --- | --- | --- |
| Community → post (feedback / complete) | 605 / 647 | 16 / 424 |
| Post → Back to feed | 181, lands on a different post | 173, same post (671 → 671) |
| Events → event (feedback / complete) | 130 / 618 | 107 / 434 |
| Event → Back to list | 351 | 108, same position |

Home as a cold launch (full page load, median of 7): server response 454 → 218, first paint 728 → 520, Home content on screen 538 → 318. JavaScript referenced by Home's HTML: 1,002 → 750 KB (297 → 231 KB gzipped).

Server time for the navigation request itself (Supabase at +110 ms per call, median of 6):

| Navigation | Before | After |
| --- | --- | --- |
| Home → Community | 418 ms, 8 calls in 3 waves | 168 ms, 7 calls in 1 wave |
| Home → Events | 600 ms, 4 waves, 385 KB | 289 ms, 2 waves, 82 KB |
| Home → Bible | 402 ms | 151 ms |
| Home → Music | 258 ms | 154 ms |
| Home → Podcasts | 401 ms | 166 ms |
| Community → post | 402 ms | 158 ms |
| Events → event | 397 ms | 162 ms |
| Community → Home | 436 ms | 197 ms |

In production, where a call is ~100–190 ms rather than a flat 110, expect each navigation to save one to two round trips (~120–350 ms) and the tap to be acknowledged within about a frame or two of the touch.

## Privacy and correctness

- Nothing is cached publicly or persisted: no new storage, service-worker, or HTTP caching. Member pages stay `private, no-store`, rendered per request, and the client router's in-memory cache settings are unchanged (dynamic pages are not reused between taps).
- Membership status, suspension, youth/adult, and capabilities are still read from the database on every request; `getClaims()` replaces only the Auth round trip that proved the token. PostgREST already trusts the same signed token for every query until it expires, so this adds no new window. With a shared-secret key, `getClaims()` falls back to asking Auth.
- Pages whose member check lived only in a section layout (Music, Books, Saved, Gallery) now check in the page as well, because a prefetch can render a section layout ahead of the tap.
- Skeletons contain no member data, and prefetches load only layouts and skeletons, per signed-in session.
- Sign-out is still a full page load with `Clear-Site-Data: "cache"`, which discards all in-memory state. Signing in as someone else in the same tab without signing out (after a session expired) now forces a reload (`src/components/layout/account-boundary.tsx`), so the previous account's Back history and saved feed can't be shown.
- Giving and youth pages keep their behaviour; giving gets the shared shell but no new caching.

## Remaining bottlenecks

1. **Supabase round trips from `iad1`.** Even a primary-key read is ~100 ms at the median (26–36 ms at best), so one wave of queries still costs ~150–300 ms per navigation in production. Worth checking the Supabase project's region against `iad1` (or setting the Vercel function region to match it) and the Free-plan compute size. This is the largest remaining lever.
2. **Client rendering on first visits.** Community's first visit still takes ~800 ms in the lab: the route's code (≈50 KB) is fetched on the tap and ten post cards render on a throttled CPU. A repeat visit is ~450 ms.
3. **React's 300 ms reveal throttle.** After a skeleton appears, React waits at least 300 ms before swapping in the page, which sets a floor of ~400 ms on "complete" for fast pages. Removing it would mean giving up the immediate skeleton.
4. **Events still needs two waves** (church time zone, then the date-range query).
5. **Pages outside these journeys** (Messages, Groups, Prayer, Profile, admin) still do the member check and their queries one after the other; the same parallel pattern applies.
6. **Shell JavaScript** is still ~750 KB raw (231 KB gzipped) before the page is interactive.
7. **Pre-existing:** the comment-link focus in `tests/e2e-local/06-community-feed.spec.ts` is flaky on `main` and on this branch alike (focus sometimes not applied within the timeout).

## Would a bundled mobile interface help?

Not materially, on this evidence. After the fixes, a navigation's time is roughly: server work waiting on Supabase (~150–300 ms in production), plus rendering on the phone. A bundled interface (the same web UI in a native wrapper, or a native rewrite that still talks to Supabase) would still make the same Supabase calls, from the phone instead of from Vercel, over a cellular link with higher and more variable latency than Vercel ↔ Supabase. What bundling would remove is the download of the app's code, which the service worker already caches after the first visit (`/_next/static/` is cache-first), and the server render, which here is a few milliseconds of the ~150–300 ms. It would add App Store review, a second codebase or wrapper to maintain, and offline storage questions for private member data. The remaining wins are cheaper on the web: co-locating the function region with Supabase, parallelising the remaining pages, and trimming shell JavaScript.

## Reproducing

Local stack only (synthetic data; the scripts refuse non-local URLs):

1. Start a local Supabase stack (`supabase start`, see [phase-11-release-readiness.md](phase-11-release-readiness.md#local-signed-in-walkthrough)) and seed it.
2. `LATENCY_MS=110 node scripts/perf/latency-gateway.mjs` (fronts `http://127.0.0.1:54321` on port 54331).
3. Build with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331` and the local key, then `npx next start -p 3100`.
4. `node scripts/perf/nav-timings.mjs http://localhost:3100 after 3` (browser journeys) and `node scripts/perf/server-profile.mjs http://localhost:3100 after 6` (server waves). Set `PLAYWRIGHT_CHROMIUM_PATH` if Playwright's browser isn't installed, and `OUT_DIR` for the JSON results.
