import { expect, test, type Page } from "@playwright/test";
import { API_URL, MEMBER, SEED_PASSWORD, noHorizontalScroll, signIn, signOut, sql } from "./helpers";

/**
 * Google and Apple sign-in against the LOCAL Supabase stack.
 *
 * Real: the app, Supabase Auth (GoTrue) building the provider redirect with
 * PKCE, GoTrue's own callback handling of a cancelled consent (it redirects
 * back to the app exactly as it would from Google or Apple), identity
 * unlinking, and every page and database check.
 *
 * Simulated (no Google or Apple servers are contacted): the provider consent
 * screen is intercepted, and "new Google/Apple accounts" are created as the
 * auth rows Supabase writes for them, then signed in with an admin magic
 * link. Hosted sign-ins with real provider accounts are a separate manual
 * step (docs/social-login-setup.md#hosted-verification).
 *
 * Needs AUTH_OAUTH_PROVIDERS=google,apple and AUTH_IDENTITY_LINKING=on on the
 * server, both providers enabled in the local supabase/config.toml with
 * placeholder credentials, and LOCAL_SUPABASE_SECRET_KEY for the admin API.
 */
const SECRET = process.env.LOCAL_SUPABASE_SECRET_KEY ?? "";
const CALLBACK = `${API_URL}/auth/v1/callback`;
const stamp = Date.now();

test.describe.configure({ mode: "serial" });

async function admin(path: string, body: object) {
  const res = await fetch(`${API_URL}/auth/v1/admin/${path}`, {
    method: "POST",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`admin ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** Writes the auth rows Supabase creates for a first Google/Apple sign-in (simulated). */
async function simulateSocialAccount(provider: "google" | "apple", email: string, userMeta: Record<string, unknown>) {
  const user = (await admin("users", { email, email_confirm: true, user_metadata: userMeta })) as { id: string };
  const sub = `sim-${provider}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  await sql("delete from auth.identities where user_id = $1", [user.id]);
  await sql(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now(), now())`,
    [sub, user.id, JSON.stringify({ sub, email, email_verified: true, ...userMeta }), provider],
  );
  await sql("update auth.users set raw_app_meta_data = $2 where id = $1", [user.id, JSON.stringify({ provider, providers: [provider] })]);
  return user.id;
}

/** Signs in without a password (admin magic link through the app's own /auth/confirm). */
async function signInByLink(page: Page, email: string) {
  const link = (await admin("generate_link", { type: "magiclink", email })) as { properties?: { hashed_token: string }; hashed_token?: string };
  const token = link.properties?.hashed_token ?? link.hashed_token;
  await page.goto(`/auth/confirm?token_hash=${token}&type=magiclink&next=%2Fhome`);
}

/**
 * Clicks a provider button and captures the provider URL Supabase sends the
 * browser to; the provider page itself is never loaded. Sign-in goes through
 * Supabase's /authorize (a redirect, read without following it); linking gets
 * the provider URL from the server and navigates straight to it.
 */
async function startProvider(page: Page, label: RegExp, host: string) {
  let captured = "";
  let refused = "";
  const stub = { status: 200, contentType: "text/html", body: "<title>provider (intercepted)</title>" };
  await page.route(`${API_URL}/auth/v1/authorize**`, async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    captured = res.headers()["location"] ?? "";
    if (!captured) refused = await res.text();
    await route.fulfill(stub);
  });
  await page.route(`https://${host}/**`, (route) => {
    captured = route.request().url();
    return route.fulfill(stub);
  });
  await page.getByRole("button", { name: label }).click();
  await expect.poll(() => captured || refused, { timeout: 15_000 }).not.toBe("");
  // This sandbox can't resolve some provider hosts, so Supabase can't load their discovery document.
  test.skip(/no such host|Unsupported provider: Get/.test(refused), `Supabase Auth couldn't reach ${host} from this environment`);
  const url = new URL(captured);
  expect(url.host).toBe(host);
  return url;
}

test.describe("screens", () => {
  for (const path of ["/sign-in", "/sign-up"]) {
    test(`${path} shows Google and Apple above the email form`, async ({ page }) => {
      await page.goto(path);
      const google = page.getByRole("button", { name: "Continue with Google" });
      const apple = page.getByRole("button", { name: "Continue with Apple" });
      await expect(google).toBeVisible();
      await expect(apple).toBeVisible();
      await expect(page.getByRole("separator", { name: "or" })).toBeVisible();
      const [g, a, email] = await Promise.all([google.boundingBox(), apple.boundingBox(), page.getByLabel(/^Email/).boundingBox()]);
      expect(a!.height).toBeGreaterThanOrEqual(g!.height); // Apple never less prominent
      expect(a!.width).toBeGreaterThanOrEqual(g!.width);
      expect(a!.y).toBeLessThan(email!.y);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/local/social${path.replace("/", "-")}-${test.info().project.name}.png`, fullPage: true });
    });
  }
});

test.describe("flows", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "flows run once");
    test.skip(!SECRET, "LOCAL_SUPABASE_SECRET_KEY is needed for the admin API");
  });

  test("Google: Supabase builds a PKCE redirect, and a cancelled consent comes back explained", async ({ page, context }) => {
    await page.goto("/sign-in?next=%2Fprayer");
    const google = await startProvider(page, /Continue with Google/, "accounts.google.com");
    expect(google.searchParams.get("redirect_uri")).toBe(CALLBACK); // provider → Supabase
    expect(google.searchParams.get("client_id")).toBe("local-test.apps.googleusercontent.com");
    expect(google.searchParams.get("scope")).toMatch(/email/);
    expect(google.searchParams.get("prompt")).toBe("select_account");
    const verifier = (await context.cookies("http://localhost:3100")).find((c) => c.name.endsWith("-auth-token-code-verifier"));
    expect(verifier, "PKCE verifier cookie on the app origin").toBeTruthy();
    expect(verifier!.httpOnly || verifier!.sameSite === "Lax").toBeTruthy();

    // The person presses Cancel at Google: Google returns error=access_denied to Supabase.
    await page.unrouteAll();
    await page.goto(`${CALLBACK}?error=access_denied&error_description=The+user+denied+the+request&state=${google.searchParams.get("state")}`);
    await page.waitForURL(/\/sign-in\?/);
    const url = new URL(page.url());
    expect(url.origin).toBe("http://localhost:3100");
    expect(url.searchParams.get("oauth_error")).toBe("cancelled");
    expect(url.searchParams.get("next")).toBe("/prayer");
    await expect(page.getByText("Sign-in was cancelled")).toBeVisible();
  });

  test("Apple: form_post redirect, and a cancelled Apple sign-in comes back explained", async ({ page }) => {
    await page.goto("/sign-in");
    const apple = await startProvider(page, /Continue with Apple/, "appleid.apple.com");
    expect(apple.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(apple.searchParams.get("client_id")).toBe("church.gathering.local.web");
    expect(apple.searchParams.get("response_mode")).toBe("form_post");
    // Apple POSTs the cancellation to Supabase's callback.
    const res = await page.request.post(CALLBACK, {
      form: { error: "user_cancelled_authorize", state: apple.searchParams.get("state")! },
      maxRedirects: 0,
    });
    expect([302, 303]).toContain(res.status());
    await page.unrouteAll();
    await page.goto(res.headers()["location"]);
    await page.waitForURL(/\/sign-in\?/);
    await expect(page.getByText("Sign-in was cancelled")).toBeVisible();
  });

  test("Apple's cancellation, as Supabase relays it to the app, is explained", async ({ page }) => {
    // What Supabase sends the browser to after Apple returns error=user_cancelled_authorize.
    await page.goto("/auth/callback?provider=apple&error=user_cancelled_authorize&error_description=user+cancelled");
    await expect(page.getByText("Sign-in was cancelled")).toBeVisible();
  });

  test("an expired or replayed callback is explained, and next can't leave the site", async ({ page }) => {
    await page.goto("/auth/callback?code=00000000-0000-0000-0000-000000000000&provider=apple");
    await expect(page.getByText("That sign-in didn't finish")).toBeVisible();
    await page.goto("/auth/callback?error=access_denied&provider=google&next=https%3A%2F%2Fevil.example");
    const url = new URL(page.url());
    expect(url.origin).toBe("http://localhost:3100");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("next")).toBeNull();
  });

  const appleEmail = `rel${stamp}@privaterelay.appleid.com`;
  test("new Apple account (simulated): relay email, no name → name step → pending", async ({ page }) => {
    const id = await simulateSocialAccount("apple", appleEmail, { is_private_email: true });
    await signInByLink(page, appleEmail);
    await page.waitForURL(/\/complete-profile/);
    await expect(page.getByRole("heading", { name: "Tell us your name" })).toBeVisible();
    await expect(page.getByText("You're using Hide My Email")).toBeVisible();
    await page.getByLabel("Full name").fill(`[TEST] Apple Walker ${stamp}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/account-status/);
    await expect(page.getByRole("heading", { name: "Thanks for registering" })).toBeVisible();
    await expect(page.getByText("Already a member with a different email?")).toBeVisible();
    await expect(page.getByText(/Apple private relay address/)).toBeVisible();
    for (const path of ["/home", "/directory", "/admin"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/account-status/);
    }
    const [p] = await sql<{ full_name: string; membership_status: string; roles: number }>(
      "select full_name, membership_status::text, (select count(*)::int from public.user_roles where user_id = $1) roles from public.profiles where id = $1",
      [id],
    );
    expect(p).toEqual({ full_name: `[TEST] Apple Walker ${stamp}`, membership_status: "pending", roles: 0 });
    await signOut(page);
  });

  test("new Google account (simulated) with a name → pending, no name step", async ({ page }) => {
    const email = `google.walker.${stamp}@gmail.example`;
    const id = await simulateSocialAccount("google", email, { full_name: `[TEST] Google Walker ${stamp}`, name: `[TEST] Google Walker ${stamp}` });
    await signInByLink(page, email);
    await page.waitForURL(/\/account-status/);
    await expect(page.getByRole("heading", { name: "Thanks for registering" })).toBeVisible();
    const [p] = await sql<{ membership_status: string }>("select membership_status::text from public.profiles where id = $1", [id]);
    expect(p.membership_status).toBe("pending");
    await signOut(page);
  });

  test("approved social member gets in; suspension applies on the next request", async ({ page }) => {
    const [{ id }] = await sql<{ id: string }>("select id from auth.users where email = $1", [appleEmail]);
    await sql("update public.profiles set membership_status = 'approved' where id = $1", [id]);
    await signInByLink(page, appleEmail);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/home/);
    await page.goto("/profile/sign-in-methods");
    await expect(page.getByRole("heading", { name: "Apple" })).toBeVisible();
    await expect(page.getByText(/(Hide My Email)/)).toBeVisible();
    await expect(page.getByText(/only way to sign in/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Disconnect Apple/ })).toHaveCount(0);

    await sql("update public.profiles set membership_status = 'suspended' where id = $1", [id]);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/account-status/);
    await expect(page.getByRole("heading", { name: "Your access is paused" })).toBeVisible();
    await page.goto("/complete-profile");
    await expect(page).toHaveURL(/\/account-status/);
    await signOut(page);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("existing member links Google through Supabase's linking flow; cancelling changes nothing", async ({ page }) => {
    const before = await sql("select id, email, full_name, membership_status::text from public.profiles where email = $1", [MEMBER]);
    await signIn(page, MEMBER, SEED_PASSWORD);
    await page.goto("/profile/sign-in-methods");
    await expect(page.getByRole("heading", { name: "Email and password" })).toBeVisible();
    const google = await startProvider(page, /Continue with Google/, "accounts.google.com");
    expect(google.searchParams.get("redirect_uri")).toBe(CALLBACK);
    await page.unrouteAll();
    await page.goto(`${CALLBACK}?error=access_denied&state=${google.searchParams.get("state")}`);
    await page.waitForURL(/\/profile\/sign-in-methods\?/);
    await expect(page.getByText("Sign-in was cancelled")).toBeVisible();
    expect(await sql("select id, email, full_name, membership_status::text from public.profiles where email = $1", [MEMBER])).toEqual(before);
    expect(await sql("select provider from auth.identities where user_id = $1", [before[0].id])).toEqual([{ provider: "email" }]);

    // The conflict message Supabase's identity_already_exists produces.
    await page.goto("/profile/sign-in-methods?oauth_error=conflict&provider=google");
    await expect(page.getByText("That Google account is already connected to a different account here")).toBeVisible();
    await signOut(page);
  });

  test("unlinking keeps a usable sign-in method and the member's data", async ({ page }) => {
    const [{ id }] = await sql<{ id: string }>("select id from auth.users where email = $1", [MEMBER]);
    const sub = `sim-google-${stamp}`;
    await sql(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values ($1, $2, $3, 'google', now(), now(), now())`,
      [sub, id, JSON.stringify({ sub, email: `member.${stamp}@gmail.example`, email_verified: true })],
    );
    await sql(`update auth.users set raw_app_meta_data = '{"provider":"email","providers":["email","google"]}' where id = $1`, [id]);
    const before = await sql("select email, full_name, membership_status::text from public.profiles where id = $1", [id]);

    await signIn(page, MEMBER, SEED_PASSWORD);
    await page.goto("/profile/sign-in-methods");
    await page.getByRole("button", { name: "Disconnect Google" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect Google" }).click();
    await page.waitForURL(/unlinked=google/);
    await expect(page.getByText("Google is disconnected.")).toBeVisible();
    expect(await sql("select provider from auth.identities where user_id = $1", [id])).toEqual([{ provider: "email" }]);
    expect(await sql("select email, full_name, membership_status::text from public.profiles where id = $1", [id])).toEqual(before);
    await signOut(page);
    await signIn(page, MEMBER, SEED_PASSWORD); // email and password still work
    await expect(page).toHaveURL(/\/home/);
    await signOut(page);
  });
});
