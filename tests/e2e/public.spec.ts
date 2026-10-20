import { expect, test } from "@playwright/test";

/**
 * Browser checks that need no live Supabase project: branding, PWA metadata,
 * protected-route redirects, accessible form errors, and keyboard access.
 * Run with `npm run build && npm run test:e2e`.
 */

test("welcome page shows the approved logo and clear actions", async ({ page }) => {
  await page.goto("/");
  const logo = page.getByRole("img", { name: "The Gathering" }).first();
  await expect(logo).toBeVisible();
  const ratio = await logo.evaluate((img: HTMLImageElement) => img.getBoundingClientRect().width / img.getBoundingClientRect().height);
  expect(ratio).toBeCloseTo(1200 / 1116, 1); // never stretched
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  // Unconfigured details show friendly empty states, not invented data.
  await expect(page.getByText("Gathering times will be posted here soon.")).toBeVisible();
  await expect(page.getByText("Contact details will be posted here soon.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("manifest and icons are served", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "The Gathering", display: "standalone", theme_color: "#F7F4ED", background_color: "#F7F4ED" });
  const purposes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "192x192:maskable", "512x512:maskable"]));
  for (const icon of manifest.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  for (const path of ["/favicon.ico", "/icon.png", "/apple-icon.png", "/sw.js", "/offline.html"]) {
    expect((await request.get(path)).ok(), path).toBe(true);
  }
});

test("head includes Apple web app metadata and icons", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "The Gathering");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#F7F4ED");
});

test("theme: light without a saved choice, saved choice rendered by the server, system follows the OS", async ({ browser, baseURL }) => {
  // No cookie: light, even when the OS prefers dark.
  const fresh = await browser.newContext({ colorScheme: "dark" });
  const p1 = await fresh.newPage();
  await p1.goto(`${baseURL}/sign-in`);
  await expect(p1.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await p1.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(247, 244, 237)");
  await fresh.close();

  // Saved dark: already in the server HTML (no flash), with a matching theme-color.
  const dark = await browser.newContext();
  await dark.addCookies([{ name: "theme", value: "dark", url: baseURL! }]);
  const html = await (await dark.request.get(`${baseURL}/sign-in`)).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  expect(html).toMatch(/<meta name="theme-color" content="#141311"/);
  await dark.close();

  // System: follows prefers-color-scheme.
  const system = await browser.newContext({ colorScheme: "dark" });
  await system.addCookies([{ name: "theme", value: "system", url: baseURL! }]);
  const p3 = await system.newPage();
  await p3.goto(`${baseURL}/sign-in`);
  expect(await p3.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 19, 17)");
  await system.close();

  // An unknown value falls back to light.
  const junk = await browser.newContext();
  await junk.addCookies([{ name: "theme", value: "sepia", url: baseURL! }]);
  const p4 = await junk.newPage();
  await p4.goto(`${baseURL}/sign-in`);
  await expect(p4.locator("html")).toHaveAttribute("data-theme", "light");
  await junk.close();
});

test("the approved logo stays legible on dark: it sits on the ivory plate", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "theme", value: "dark", url: baseURL! }]);
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/`);
  const plate = page.locator(".brand-plaque").first();
  expect(await plate.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(247, 244, 237)");
  await ctx.close();
});

for (const path of [
  "/home",
  "/profile",
  "/announcements",
  "/admin",
  "/admin/members",
  "/admin/settings",
  // Phase 2
  "/directory",
  "/directory/00000000-0000-0000-0000-000000000000",
  "/profile/edit",
  "/profile/privacy",
  "/profile/photo",
  "/profile/preview",
  "/profile/household",
  "/admin/ministry-interests",
  // Phase 3
  "/giving",
  "/admin/finance",
  "/admin/finance/contributions",
  // Phase 5
  "/community",
  "/community/new",
  "/community/guidelines",
  "/community/t/00000000-0000-0000-0000-000000000000",
  "/groups",
  "/groups/invitations",
  "/groups/00000000-0000-0000-0000-000000000000/manage",
  "/messages",
  "/messages/new",
  "/messages/00000000-0000-0000-0000-000000000000",
  "/notifications",
  "/notifications/settings",
  "/admin/community",
  // Phase 6
  "/prayer",
  "/prayer/new",
  "/prayer/00000000-0000-0000-0000-000000000000",
  "/prayer/00000000-0000-0000-0000-000000000000/edit",
  "/prayer/care",
  "/prayer/care/new",
  "/prayer/care/00000000-0000-0000-0000-000000000000",
  "/prayer/serve",
  "/prayer/team",
  "/prayer/team/care/00000000-0000-0000-0000-000000000000",
  "/admin/prayer",
  "/admin/prayer/settings",
  "/admin/prayer/access",
  // Phase 7 (members-only sections and administration)
  "/reading",
  "/reading/books/00000000-0000-0000-0000-000000000000",
  "/reading/assignments/00000000-0000-0000-0000-000000000000",
  "/music",
  "/music/00000000-0000-0000-0000-000000000000",
  "/gallery",
  "/gallery/mine",
  "/gallery/00000000-0000-0000-0000-000000000000",
  "/saved",
  "/admin/content",
  "/admin/content/new",
  "/admin/content/calendar",
  "/admin/content/library",
  "/admin/content/00000000-0000-0000-0000-000000000000/preview",
  "/admin/media",
  "/admin/media/settings",
  "/admin/media/cleanup",
  "/admin/podcasts",
  "/admin/gallery",
  "/admin/gallery/reports",
  // Phase 8 (Bible reading, journals, and their administration)
  "/bible",
  "/bible/today",
  "/bible/read",
  "/bible/read/WEB/JHN/3",
  "/bible/bookmarks",
  "/bible/plans/00000000-0000-0000-0000-000000000000",
  "/bible/plans/00000000-0000-0000-0000-000000000000/catch-up",
  "/bible/day/00000000-0000-0000-0000-000000000000",
  "/journal",
  "/journal/new",
  "/journal/00000000-0000-0000-0000-000000000000",
  "/admin/bible",
  "/admin/bible/plans/new",
  "/admin/bible/plans/00000000-0000-0000-0000-000000000000",
  "/admin/bible/sources",
  "/admin/bible/sources/imports/00000000-0000-0000-0000-000000000000",
  // Design reference (administrators only)
  "/design/icons",
  "/admin/moderation",
]) {
  test(`signed-out visitors are sent to sign-in from ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path).replace(/%2F/g, "(%2F|/)")}`));
    expect(response?.headers()["cache-control"] ?? "").not.toContain("public");
    await expect(page.getByRole("heading", { name: "Welcome to The Gathering" })).toBeVisible();
  });
}

test("registration explains the members-only directory and how to hide", async ({ page }) => {
  await page.goto("/sign-up");
  const note = page.getByText("About the member directory");
  await expect(note).toBeVisible();
  await expect(page.getByText(/only signed-in approved members/)).toBeVisible();
  await expect(page.getByText(/hide your whole listing/)).toBeVisible();
});

test("protected directory responses are never publicly cacheable", async ({ request }) => {
  const res = await request.get("/directory", { maxRedirects: 0 });
  expect(res.headers()["cache-control"]).toContain("private");
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test("community API answers signed-out visitors with 401 and is never cacheable", async ({ request }) => {
  for (const path of ["/api/community/unread", "/api/community/conversations/00000000-0000-0000-0000-000000000000"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([401, 503]).toContain(res.status());
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
});

test("protected community responses are never publicly cacheable", async ({ request }) => {
  for (const path of ["/community", "/messages", "/groups", "/notifications"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.headers()["cache-control"]).toContain("private");
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
});

test("protected prayer and care responses are never publicly cacheable", async ({ request }) => {
  for (const path of ["/prayer", "/prayer/care", "/prayer/team", "/prayer/serve"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.headers()["cache-control"]).toContain("private");
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
});

test("teaching, gallery, and saved responses are never publicly cacheable", async ({ request }) => {
  for (const path of ["/reading", "/music", "/gallery", "/saved", "/devotionals", "/lessons", "/podcasts", "/media"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.headers()["cache-control"], path).toContain("private");
    expect(res.headers()["cache-control"], path).toContain("no-store");
  }
});

test("media delivery routes refuse unknown files without a cacheable answer", async ({ request }) => {
  const id = "00000000-0000-0000-0000-000000000000";
  for (const path of [`/api/media/${id}/play`, `/api/media/${id}/file`, `/api/media/${id}/vtt`, `/api/podcast/episodes/${id}/audio`, `/api/podcast/artwork/${id}`]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([401, 403, 404, 503], path).toContain(res.status());
    expect(res.headers()["location"], path).toBeUndefined();
    expect(res.headers()["cache-control"] ?? "", path).not.toContain("public");
  }
  for (const path of [`/api/media/not-an-id/play`, `/api/podcast/episodes/not-an-id/audio`]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
});

test("the service worker never caches teaching media or photos", async ({ request }) => {
  const sw = await (await request.get("/sw.js")).text();
  for (const p of ["/api/media", "/gallery", "/storage/v1"]) expect(sw).not.toContain(p);
});

test("the service worker never caches prayer pages", async ({ request }) => {
  const sw = await (await request.get("/sw.js")).text();
  expect(sw).not.toContain("/prayer");
});

test("the service worker handles push without caching private pages", async ({ request }) => {
  const sw = await (await request.get("/sw.js")).text();
  expect(sw).toContain('addEventListener("push"');
  expect(sw).toContain("/notifications/open/");
  expect(sw).not.toMatch(/cache\.put\([^)]*navigate/);
});

test("guest giving page is public and honest when giving isn't configured", async ({ page }) => {
  await page.goto("/give");
  await expect(page.getByRole("heading", { name: "Thank you for giving" })).toBeVisible();
  await expect(page.getByText("Online giving isn't available yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /checkout/i })).toHaveCount(0);
});

test("thank-you page never claims success without confirmation", async ({ page }) => {
  await page.goto("/give/thanks?session_id=cs_test_aaaaaaaaaaaaaaaa");
  await expect(page.getByText("We couldn't find that checkout.")).toBeVisible();
  await expect(page.getByText("Thank you for your gift")).toHaveCount(0);
});

test("Stripe webhook refuses requests when not configured", async ({ request }) => {
  const res = await request.post("/api/stripe/webhook", { data: "{}", headers: { "stripe-signature": "t=1,v1=x" } });
  expect(res.status()).toBe(503);
});

test("sign-in shows accessible field errors", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in" }).click();
  const email = page.getByLabel("Email address");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  const describedBy = await email.getAttribute("aria-describedby");
  expect(describedBy).toContain("field-email-error");
  await expect(page.getByRole("alert").first()).toBeVisible();
});

test("sign-up validates password rules and matching", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Test Person");
  await page.getByLabel("Email").fill("person@example.test");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("different");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
  await expect(page.getByText("The passwords don't match.")).toBeVisible();
  // Values (except passwords) survive the round trip.
  await expect(page.getByLabel("Email")).toHaveValue("person@example.test");
});

test("without a configured service, sign-in reports it honestly", async ({ page }) => {
  test.skip(Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), "Only meaningful when Supabase is not configured");
  await page.goto("/sign-in");
  await expect(page.getByText("Sign-in isn't available yet")).toBeVisible();
  await page.getByLabel("Email").fill("person@example.test");
  await page.getByLabel("Password", { exact: true }).fill("whatever-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "temporarily unavailable" })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("sign-in page matches the approved layout and stays usable", async ({ page }, info) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to The Gathering" })).toBeVisible();
  await expect(page.getByText("A place to belong.")).toBeVisible();
  await expect(page.getByText("Faith. Fellowship. Life together.")).toBeVisible();
  const email = page.getByLabel("Email address");
  const password = page.getByLabel("Password", { exact: true });
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up");

  // The logo is never stretched.
  const logo = page.getByRole("img", { name: "The Gathering" }).first();
  const ratio = await logo.evaluate((img: HTMLImageElement) => img.getBoundingClientRect().width / img.getBoundingClientRect().height);
  expect(ratio).toBeCloseTo(1200 / 1116, 1);

  // Inputs are at least 16px (no iOS zoom) and the form is near the top on phones.
  expect(await email.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  if (info.project.name === "mobile") {
    const box = await email.boundingBox();
    expect(box!.y).toBeLessThan(page.viewportSize()!.height * 0.75);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("password visibility toggle is an accessible button", async ({ page }) => {
  await page.goto("/sign-in");
  const password = page.getByLabel("Password", { exact: true });
  const toggle = page.getByRole("button", { name: "Show password" });
  await password.fill("secret-value-1");
  await expect(password).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveValue("secret-value-1");
  // Toggling never submits the form.
  await expect(page.getByText("Please correct the highlighted fields.")).toHaveCount(0);
  await toggle.click();
  await expect(password).toHaveAttribute("type", "password");
});

test("keyboard users can skip to content and see focus", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("sign-out only accepts POST", async ({ request }) => {
  expect((await request.get("/auth/sign-out")).status()).toBe(405);
  const res = await request.post("/auth/sign-out", { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["clear-site-data"]).toBe('"cache"');
});

test("install guidance covers iPhone", async ({ page }) => {
  await page.goto("/install");
  await expect(page.getByRole("heading", { name: "iPhone and iPad (Safari)" })).toBeVisible();
  await expect(page.getByText("Scroll down and tap “Add to Home Screen”.")).toBeVisible();
});

test("visual snapshots for review", async ({ page }, info) => {
  for (const [name, path] of [["welcome", "/"], ["sign-in", "/sign-in"], ["sign-up", "/sign-up"], ["install", "/install"]]) {
    await page.goto(path);
    await page.screenshot({ path: `test-results/screens/${info.project.name}-${name}.png`, fullPage: true });
  }
});

test("Bible reading and journal responses are never publicly cacheable", async ({ request }) => {
  for (const path of ["/bible", "/bible/bookmarks", "/journal", "/journal/new"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.headers()["cache-control"], path).toContain("private");
    expect(res.headers()["cache-control"], path).toContain("no-store");
  }
});

test("journal and Bible APIs refuse signed-out visitors without a cacheable answer", async ({ request }) => {
  const id = "00000000-0000-0000-0000-000000000000";
  const save = await request.put(`/api/journal/entries/${id}`, { data: { title: "Synthetic", body: "Synthetic", base_version: 1 } });
  expect([401, 503]).toContain(save.status());
  expect(save.headers()["cache-control"]).toContain("no-store");
  const create = await request.post("/api/journal/entries", { data: { client_key: id, title: "Synthetic", body: "Synthetic" } });
  expect([401, 503]).toContain(create.status());
  expect(create.headers()["cache-control"]).toContain("no-store");
  for (const path of ["/api/journal/export", "/api/journal/export?scope=all", `/api/bible/references/${id}`, "/admin/bible/template?mode=calendar"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).not.toBe(200);
    expect(res.headers()["location"] ?? "", path).not.toContain("supabase");
    expect(res.headers()["cache-control"] ?? "", path).not.toContain("public");
  }
});

test("the service worker never caches Bible reading or journal pages", async ({ request }) => {
  const sw = await (await request.get("/sw.js")).text();
  for (const p of ["/bible", "/journal", "/api/journal"]) expect(sw).not.toContain(p);
});
