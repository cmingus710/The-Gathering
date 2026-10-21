import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, signOut } from "./helpers";

/**
 * Automated accessibility scans (axe, WCAG 2.x A/AA rules) on representative
 * signed-out, member, and administrator routes in both projects (desktop and
 * Pixel 7), plus keyboard, narrow-screen, and service-worker cache checks.
 * Automated scans catch only part of WCAG; screen-reader and device checks
 * are listed separately in docs/phase-11-release-readiness.md.
 */

const SIGNED_OUT = ["/", "/sign-in", "/sign-up", "/forgot-password", "/install", "/events"];
const MEMBER_ROUTES = ["/home", "/directory", "/profile", "/community", "/messages", "/notifications", "/notifications/settings", "/prayer", "/prayer/new", "/events/calendar", "/giving", "/bible", "/memory", "/gallery", "/youth"];
const ADMIN_ROUTES = ["/admin", "/admin/members", "/admin/events/new", "/admin/moderation", "/admin/settings", "/admin/youth"];

async function scan(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `${path}: ${summary.join("\n")}`).toEqual([]);
  await noHorizontalScroll(page);
}

test("signed-out pages pass automated checks", async ({ page }) => {
  for (const path of SIGNED_OUT) await scan(page, path);
});

test("member pages pass automated checks", async ({ page }) => {
  await signIn(page, MEMBER);
  for (const path of MEMBER_ROUTES) await scan(page, path);
});

test("administrator pages pass automated checks", async ({ page }) => {
  await signIn(page, ADMIN);
  for (const path of ADMIN_ROUTES) await scan(page, path);
});

test("dark theme passes contrast checks on the home page", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page, MEMBER);
  await scan(page, "/home");
});

test("narrowest phones (320px) and 200% text don't scroll sideways", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, MEMBER);
  for (const path of ["/home", "/community", "/prayer", "/events/calendar", "/profile", "/memory"]) {
    await page.goto(path);
    await noHorizontalScroll(page);
  }
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.goto("/home");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await noHorizontalScroll(page);
  await context.close();
});

test("keyboard: skip link, visible focus, and the phone More menu", async ({ page }, info) => {
  await signIn(page, MEMBER);
  await page.goto("/home");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /skip to (main )?content/i });
  await expect(skip).toBeFocused();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth);
  expect(outline).not.toMatch(/^none/);
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  if (info.project.name === "mobile") {
    const dock = page.getByRole("navigation", { name: "Main" }).last();
    const home = dock.getByRole("link", { name: "Home" });
    await expect(home).toHaveAttribute("aria-current", "page");
    // Dock sits above the bottom safe area and inside the viewport.
    const box = await dock.boundingBox();
    const vh = page.viewportSize()!.height;
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
    await dock.getByRole("button", { name: /More/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(dock.getByRole("button", { name: /More/ })).toBeFocused();
  }
});

test("reduced motion is honored", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, MEMBER);
  await page.goto("/home");
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a, button, [class*='transition'], [class*='animate']")]
      .slice(0, 200)
      .map((el) => parseFloat(getComputedStyle(el).transitionDuration) + parseFloat(getComputedStyle(el).animationDuration))
      .filter((d) => d > 0.02),
  );
  expect(durations).toEqual([]);
});

test("service worker caches no private pages, and sign-out leaves none behind", async ({ page }) => {
  // Production builds register the worker; wait for it to control the page.
  await page.goto("/sign-in");
  const registered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    return reg ? "ready" : "none";
  });
  test.skip(registered !== "ready", `service worker ${registered}`);
  await signIn(page, MEMBER);
  for (const path of ["/home", "/messages", "/giving", "/prayer", "/youth", "/api/community/unread"]) await page.goto(path);
  const cached = async () =>
    page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
      }
      return urls;
    });
  const during = await cached();
  const allowed = /^\/(_next\/static\/|brand\/|icons\/|offline\.html$)/;
  expect(during.filter((u) => !allowed.test(u)), "only public static assets are cached").toEqual([]);

  await signOut(page);
  await page.goto("/sign-in");
  const after = await cached();
  expect(after.filter((u) => !allowed.test(u))).toEqual([]);
  // Offline navigation shows the generic fallback, never a private page.
  await page.context().setOffline(true);
  await page.goto("/messages").catch(() => undefined);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/Synthetic Member|Synthetic Editor|Your giving|Messages\b.*conversation/);
  await page.context().setOffline(false);
});
