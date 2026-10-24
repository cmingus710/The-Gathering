import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Morning & Evening (local stack only, migration 20261118000100): the dry
 * run and import of the real pinned file into a draft, review and
 * correction, publishing, the member's daily view (Morning/Evening, date
 * picker, Today, previous/next across the year boundary, February 29),
 * search, direct links, a private reflection that opens again instead of
 * duplicating, accessibility in light and dark, and hiding. Starts by
 * removing any earlier run's collection (journal text is kept by design).
 * Set DEVOTIONAL_SHOTS to a folder to save screenshots.
 */
const SHOTS = process.env.DEVOTIONAL_SHOTS;
const KEY = "morning-evening";
const BASE = `/devotionals/collections/${KEY}`;
// Not-found pages stream with the app shell, so check the page, not the status code (as 02-member-journeys does).
const NOT_FOUND = /couldn't find|not found|isn't available/i;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
};

async function as(browser: Browser, email: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use;
  const page = await (await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL })).newPage();
  await signIn(page, email);
  return page;
}

const memberToday = async () =>
  (
    await sql<{ d: string }>(
      "select to_char((now() at time zone community.member_tz(p.id))::date, 'YYYY-MM-DD') d from public.profiles p join auth.users u on u.id = p.id where u.email = $1",
      [MEMBER],
    )
  )[0].d;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql("delete from media.collections where key = $1", [KEY]);
});

test("a publisher reviews the dry run and imports into a hidden draft, with no notices", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await as(browser, ADMIN);
  const before = await sql<{ n: number }>("select (select count(*) from community.notifications) + (select count(*) from community.email_outbox) + (select count(*) from community.push_outbox) n");
  await admin.goto("/admin/content/collections/import");
  await expect(admin.getByText("Ready to import")).toBeVisible();
  await expect(admin.getByText("732 (morning 366, evening 366)")).toBeVisible();
  await expect(admin.getByText("366 of 366")).toBeVisible();
  await expect(admin.getByText("morning present, evening present")).toBeVisible();
  await shot(admin, "import-dry-run");
  await admin.getByRole("button", { name: "Import into a draft collection" }).click();
  await admin.waitForURL(/\/admin\/content\/collections\/[0-9a-f-]{36}\?imported=/, { timeout: 120_000 });
  await expect(admin.getByText("Import finished.")).toBeVisible();
  await expect(admin.getByText(/732 readings checked: 732 added/).first()).toBeVisible();
  await expect(admin.getByText("Draft · not visible").first()).toBeVisible();
  await shot(admin, "admin-collection");
  const after = await sql<{ n: number }>("select (select count(*) from community.notifications) + (select count(*) from community.email_outbox) + (select count(*) from community.push_outbox) n");
  expect(after[0].n).toBe(before[0].n);

  // Unpublished: members can't discover or open it.
  const member = await as(browser, MEMBER);
  await member.goto("/devotionals");
  await expect(member.getByRole("heading", { name: "Daily reading collections" })).toHaveCount(0);
  await member.goto(BASE);
  await expect(member.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
  await member.context().close();

  // A correction applies to that calendar reading in every year.
  await admin.getByLabel("Month").selectOption("1");
  await admin.getByRole("button", { name: "Filter", exact: true }).click();
  await admin.getByRole("link", { name: /January 2 · Morning/ }).click();
  await expect(admin.getByText(/a correction changes the January 2 · Morning reading for every year/)).toBeVisible();
  const text = admin.getByLabel("Text");
  const original = await text.inputValue();
  await text.fill(`${original}\n\n[TEST] correction`);
  await admin.getByRole("button", { name: "Save correction" }).click();
  await expect(admin.getByText("Correction saved. It applies to this reading in every year.")).toBeVisible();
  await expect(admin.getByText("Corrected").first()).toBeVisible();
  await admin.getByRole("button", { name: "Restore the imported text" }).click();
  await expect(admin.getByText("Text restored.")).toBeVisible();
  await expect(admin.getByLabel("Text")).toHaveValue(original);

  await admin.goto((await sql<{ id: string }>("select id from media.collections where key = $1", [KEY])).map((r) => `/admin/content/collections/${r.id}`)[0]);
  await admin.getByRole("button", { name: "Publish and show to members" }).click();
  await expect(admin.getByText("Published. Members can read it now.")).toBeVisible();
  await admin.context().close();
});

test("members read today's morning and evening, navigate days, search, and reflect privately", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await as(browser, MEMBER);
  const today = await memberToday();

  await page.goto("/devotionals");
  const card = page.getByRole("article", { name: "Morning & Evening" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Daily readings by Charles Spurgeon")).toBeVisible();
  await expect(card.getByRole("link", { name: /Today's Morning reading/ })).toBeVisible();
  await expect(card.getByRole("link", { name: /Today's Evening reading/ })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, "devotionals-landing");

  await card.getByRole("link", { name: /Today's Morning reading/ }).click();
  await expect(page).toHaveURL(`${BASE}?date=${today}&slot=morning`);
  await expect(page.getByRole("link", { name: "Morning", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("by Charles Spurgeon").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "About this text" })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, "reading-today-morning");

  // Keyboard: the Evening button is reachable and works with Enter.
  await page.getByRole("link", { name: "Evening", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${BASE}?date=${today}&slot=evening`);
  await expect(page.getByRole("link", { name: "Evening", exact: true })).toHaveAttribute("aria-current", "page");

  // December 31 evening → January 1 morning of the next year.
  await page.goto(`${BASE}?date=2026-12-31&slot=evening`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Thursday, December 31");
  await page.getByRole("link", { name: /Next reading: Jan 1, 2027 · Morning/ }).click();
  await expect(page).toHaveURL(`${BASE}?date=2027-01-01&slot=morning`);
  await expect(page.getByText('"They did eat of the fruit of the land of Canaan that year."')).toBeVisible();
  await page.getByRole("link", { name: /Previous reading: Dec 31, 2026 · Evening/ }).click();
  await expect(page).toHaveURL(`${BASE}?date=2026-12-31&slot=evening`);

  // The date picker; February 29 in a leap year, and beside February 28 in a common year.
  await page.getByLabel("Date").fill("2028-02-29");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page).toHaveURL(`${BASE}?date=2028-02-29&slot=evening`);
  await expect(page.getByRole("complementary", { name: "Leap-day readings" })).toHaveCount(0);
  await page.goto(`${BASE}?date=2027-02-28&slot=morning`);
  const leap = page.getByRole("complementary", { name: "Leap-day readings" });
  await expect(leap).toContainText("2027 has no February 29");
  await leap.getByRole("link", { name: /February 29 · Morning/ }).click();
  await expect(page).toHaveURL(/\/readings\/[0-9a-f-]{36}\?on=2027-02-28$/);
  await expect(page.getByText('"With lovingkindness have I drawn thee."')).toBeVisible();
  await shot(page, "leap-day");

  // Search shows the calendar day and morning/evening; results open by direct link.
  await page.goto(BASE);
  await page.getByRole("searchbox", { name: "Search Morning & Evening" }).fill("land of Canaan");
  await page.getByRole("button", { name: "Search" }).click();
  const hit = page.getByRole("link", { name: /January 1 · Morning · Joshua 5:12/ });
  await expect(hit).toBeVisible();
  await shot(page, "search");
  await hit.click();
  await expect(page).toHaveURL(/\/readings\/[0-9a-f-]{36}$/);
  const direct = page.url();

  // A reflection is private, dated, and opened again rather than duplicated.
  await page.getByRole("link", { name: "Reflect in My Journal" }).click();
  await expect(page.getByText(/About Morning & Evening: January 1 · Morning/)).toBeVisible();
  await page.getByRole("textbox", { name: "Entry" }).fill("[TEST] A private reflection on the promised rest.");
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
  const entryUrl = page.url();
  await page.goto(direct);
  await page.getByRole("link", { name: "Open my reflection" }).click();
  await expect(page).toHaveURL(entryUrl);
  const year = (await memberToday()).slice(0, 4);
  // Opening the "new reflection" address again for the same date goes to the same entry.
  const readingId = direct.split("/").pop();
  await page.goto(`/journal/new?reading=${readingId}&on=${year}-01-01`);
  await expect(page).toHaveURL(entryUrl);
  await page.context().close();
});

test("the reading page passes axe in light and dark themes", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const url of [`${BASE}?date=2026-03-16&slot=morning`, `${BASE}/search?q=stranger`, "/devotionals"]) {
      await page.goto(url);
      // The theme is the member's saved choice (data-theme on <html>); set it directly.
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), scheme);
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations.map((v) => `${scheme} ${url}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
    await page.goto(`${BASE}?date=2026-03-16&slot=morning`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), scheme);
    await shot(page, `reading-${scheme}`);
  }
  await page.context().close();
});

test("hiding removes discovery and access but keeps the member's journal text", async ({ browser }) => {
  const admin = await as(browser, ADMIN);
  const [{ id }] = await sql<{ id: string }>("select id from media.collections where key = $1", [KEY]);
  await admin.goto(`/admin/content/collections/${id}`);
  await admin.getByRole("button", { name: "Hide from members" }).click();
  await expect(admin.getByText(/Hidden\. Members can no longer find or open it/)).toBeVisible();

  const member = await as(browser, MEMBER);
  await member.goto("/devotionals");
  await expect(member.getByRole("article", { name: "Morning & Evening" })).toHaveCount(0);
  await member.goto(BASE);
  await expect(member.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
  const [{ entry }] = await sql<{ entry: string }>(
    "select e.id entry from journal.entries e join auth.users u on u.id = e.profile_id where u.email = $1 and e.link_kind = 'collection_reading' order by e.created_at desc limit 1",
    [MEMBER],
  );
  await member.goto(`/journal/${entry}`);
  await expect(member.getByText(/About a devotional reading for January 1, \d{4} that's no longer available\. Your note is kept\./)).toBeVisible();
  await expect(member.getByRole("textbox", { name: "Entry" })).toHaveValue("[TEST] A private reflection on the promised rest.");

  await admin.getByRole("button", { name: "Show to members again" }).click();
  await expect(admin.getByText("Shown to members again.")).toBeVisible();
  await admin.context().close();
  await member.context().close();
});
