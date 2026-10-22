import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Section back links (local stack only): every detail page goes up one level
 * to its parent list, whether it was reached by browsing, a direct link or
 * bookmark, or a notification; it keeps the reader's approved list filters
 * and the feed's place, ignores tampered return values, and leaves browser
 * Back and unsaved-change prompts alone. Screenshots of the link on phone
 * and desktop, light and dark, go to test-results/local/back-links.
 */
const stamp = Date.now();
const SHOTS = "test-results/local/back-links";
let category = "";
let thread = "";
let occurrence = "";
let playlist = "";
let eventCategory = "";

async function as(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  return page;
}
const back = (page: Page) => page.getByRole("link", { name: /^Back to / }).first();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  await sql("delete from community.rate_events");
  const [{ id: member }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [MEMBER]);
  const [{ id: admin }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [ADMIN]);
  for (const id of [member, admin]) {
    await sql("insert into community.guideline_acks (profile_id, version) select $1, guidelines_version from community.settings on conflict do nothing", [id]);
  }
  [{ id: category }] = await sql<{ id: string }>("select id from community.categories where active order by sort_order limit 1");
  // Earlier runs' posts would push these off the feed's first page.
  await sql("delete from community.notifications where thread_id in (select id from community.threads where title like '[TEST] Back %')");
  await sql("delete from community.threads where title like '[TEST] Back %'");
  // The newest posts in the feed, enough that it scrolls; the member's own post is lower down.
  for (let i = 0; i < 12; i++) {
    const [{ id }] = await sql<{ id: string }>(
      "insert into community.threads (category_id, author_id, title, body, created_at, last_activity_at) values ($1, $2, $3, 'Synthetic body for the back link walkthrough.', now() - make_interval(secs => $4), now() - make_interval(secs => $4)) returning id",
      [category, i === 6 ? member : admin, `[TEST] Back ${stamp} #${i}`, 1 + i],
    );
    if (i === 6) thread = id;
  }
  [{ id: eventCategory }] = await sql<{ id: string }>("select id from events.categories order by name limit 1");
  await sql("delete from media.items where title like '[TEST] Back %'");
  [{ id: playlist }] = await sql<{ id: string }>(
    `insert into media.items (kind, title, summary, status, publish_at, audience, spotify_id)
     values ('playlist', $1, 'Synthetic playlist.', 'published', now() - interval '1 minute', 'members', '37i9dQZF1DXcBWIGoYBM5M') returning id`,
    [`[TEST] Back ${stamp} playlist`],
  );
});

test("setup: an administrator publishes a categorized event", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "once");
  const admin = await as(browser, ADMIN);
  await admin.goto("/admin/events/new");
  await admin.getByLabel("Title").fill(`[TEST] Back ${stamp} event`);
  await admin.getByLabel("Date", { exact: true }).fill(new Date(Date.now() + 9 * 86400_000).toISOString().slice(0, 10));
  await admin.getByLabel("Start time").fill("09:30");
  await admin.getByLabel("End time").fill("11:00");
  await admin.getByLabel("Category").selectOption(eventCategory);
  await admin.getByLabel("Members register (RSVP) for this event").check();
  await admin.getByRole("button", { name: "Save as draft" }).click();
  await admin.waitForURL(/\/admin\/events\/[0-9a-f-]{36}/);
  await admin.getByRole("button", { name: /^Publish/ }).first().click();
  const dialog = admin.getByRole("dialog");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^Publish/ }).last().click();
  await expect(admin.getByText(/published/i).first()).toBeVisible();
  await admin.close();
});

test("events: back keeps the category filter, even after registering and cancelling", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "once");
  [{ id: occurrence }] = await sql<{ id: string }>(
    "select o.id from events.occurrences o join events.series s on s.id = o.series_id where s.title = $1 limit 1",
    [`[TEST] Back ${stamp} event`],
  );
  const page = await as(browser, MEMBER);
  await page.goto(`/events?category=${eventCategory}`);
  await page.getByRole("link", { name: `[TEST] Back ${stamp} event` }).first().click();
  await page.waitForURL(`**/events/${occurrence}`);
  await expect(back(page)).toHaveText("Back to Events");
  await expect(back(page)).toHaveAttribute("href", `/events?category=${eventCategory}`);
  // Interactions on the page (server actions re-render it) don't change the destination.
  await page.getByRole("button", { name: /^(Register|RSVP|I'm coming|Count me in)/ }).first().click();
  await expect(page.getByText(/you're registered|registered/i).first()).toBeVisible();
  await page.getByRole("button", { name: /^Cancel (my )?(registration|RSVP)/ }).first().click();
  const confirm = page.getByRole("dialog");
  if (await confirm.count()) await confirm.getByRole("button", { name: /^(Yes|Cancel registration|Cancel RSVP)/ }).last().click();
  await back(page).click();
  await page.waitForURL(`**/events?category=${eventCategory}`);
  // Browser Back is ordinary history.
  await page.goBack();
  await page.waitForURL(`**/events/${occurrence}`);
  await page.close();
});

test("direct links, bookmarks, and notifications get the same parent", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "once");
  const page = await as(browser, MEMBER);
  // A fresh tab straight onto detail pages: the plain parent.
  for (const [url, label, href] of [
    [`/events/${occurrence}`, "Back to Events", "/events"],
    [`/community/t/${thread}`, "Back to Community", "/community"],
    [`/music/${playlist}`, "Back to Music & playlists", "/music"],
    ["/profile/edit", "Back to Profile", "/profile"],
    ["/notifications/settings", "Back to Notifications", "/notifications"],
  ] as const) {
    await page.goto(url);
    await expect(back(page), url).toHaveText(label);
    await expect(back(page), url).toHaveAttribute("href", href);
    await expect(page.getByRole("link", { name: /^Back to / })).toHaveCount(1);
  }
  // A notification click-through lands on the post with the same back link.
  const [{ id: member }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [MEMBER]);
  const [{ id: n }] = await sql<{ id: string }>(
    "insert into community.notifications (profile_id, kind, category, thread_id) values ($1, 'reply_mine', 'forum', $2) returning id",
    [member, thread],
  );
  await page.goto(`/notifications/open/${n}`);
  await page.waitForURL(`**/community/t/${thread}**`);
  await expect(back(page)).toHaveAttribute("href", "/community");
  await back(page).click();
  await page.waitForURL(/\/community$/);
  await page.close();
});

test("community: back returns to the filtered feed at the same place", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "once");
  const page = await as(browser, MEMBER);
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto(`/community?category=${category}`);
  const link = page.getByRole("link", { name: `[TEST] Back ${stamp} #6` });
  await link.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(200);
  await link.click();
  await page.waitForURL(`**/community/t/${thread}`);
  await expect(back(page)).toHaveAttribute("href", `/community?category=${category}`);
  await back(page).click();
  await page.waitForURL(`**/community?category=${category}`);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 50);
  await page.close();
});

test("tampered return values fall back to the plain parent", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "once");
  const page = await as(browser, MEMBER);
  await page.goto("/events");
  for (const evil of ["https://evil.example/events", "//evil.example", "/admin?x=1", "/events?next=//evil.example&view=month"]) {
    await page.evaluate((v) => sessionStorage.setItem("return-view:/events", v), evil);
    await page.goto(`/events/${occurrence}`);
    await expect(back(page), evil).toHaveAttribute("href", evil.includes("view=month") ? "/events?view=month" : "/events");
  }
  await page.close();
});

test("unsaved profile edits still ask before leaving by the back link", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "once");
  const page = await as(browser, MEMBER);
  await page.goto("/profile/edit");
  await page.getByLabel(/^Preferred name/).fill(`Back ${stamp}`);
  let asked = false;
  page.once("dialog", (d) => {
    asked = true;
    void d.dismiss();
  });
  await back(page).click();
  await expect.poll(() => asked).toBe(true);
  await expect(page).toHaveURL(/\/profile\/edit$/);
  await page.close();
});

test("keyboard: the back link is the first thing in the page content", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "once");
  const page = await as(browser, MEMBER);
  await page.goto(`/music/${playlist}`);
  await page.locator("#main").focus();
  await page.keyboard.press("Tab");
  await expect(back(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/music$/);
  await page.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots: ${scheme}`, async ({ browser }, info) => {
    const context = await browser.newContext({ ...info.project.use, colorScheme: scheme });
    // The app's own theme choice (a cookie) wins over the system setting.
    await context.addCookies([{ name: "theme", value: scheme, url: "http://localhost:3100" }]);
    const page = await context.newPage();
    await signIn(page, MEMBER);
    for (const [name, url] of [
      ["event", `/events/${occurrence || (await sql<{ id: string }>("select o.id from events.occurrences o join events.series s on s.id = o.series_id where s.title like '[TEST] Back %' order by o.starts_at desc limit 1"))[0]?.id}`],
      ["post", `/community/t/${thread}`],
      ["playlist", `/music/${playlist}`],
      ["profile-edit", "/profile/edit"],
    ] as const) {
      await page.goto(url);
      await expect(back(page)).toBeVisible();
      await noHorizontalScroll(page);
      // Nothing sticky covers the link or the heading.
      const box = await back(page).boundingBox();
      const header = await page.locator("header.sticky, div.sticky.top-0").filter({ visible: true }).first().boundingBox();
      if (box && header) expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${scheme}-${name}.png` });
    }
    await context.close();
  });
}
