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
  expect(manifest).toMatchObject({ name: "The Gathering", display: "standalone", theme_color: "#121110", background_color: "#121110" });
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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#121110");
});

for (const path of ["/home", "/profile", "/announcements", "/admin", "/admin/members", "/admin/settings"]) {
  test(`signed-out visitors are sent to sign-in from ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path).replace(/%2F/g, "(%2F|/)")}`));
    expect(response?.headers()["cache-control"] ?? "").not.toContain("public");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });
}

test("sign-in shows accessible field errors", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in" }).click();
  const email = page.getByLabel("Email");
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
  await page.getByLabel("Password").fill("whatever-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "temporarily unavailable" })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
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
