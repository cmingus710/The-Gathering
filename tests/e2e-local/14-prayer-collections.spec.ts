import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Prayer Library collections (local stack only): a settings manager creates a
 * collection and gives it a cropped cover; a member publishes a prayer into
 * it from the editor; another member browses the collection cards, opens the
 * collection (direct link too), searches within it and across all prayers,
 * opens a prayer and comes back to the same collection and search; the
 * administrator moves the prayer out in bulk (the collection then disappears
 * for members, direct link included) and archives the collection. Also: no
 * sideways scrolling on a phone, and both themes pass axe. Everything here is
 * synthetic and tagged [TEST]. Set LIBRARY_SHOTS to a folder to save
 * screenshots.
 */
const SHOTS = process.env.LIBRARY_SHOTS;
const stamp = Date.now() % 100000;
const COLLECTION = `[TEST] Morning Prayers ${stamp}`;
const TITLE = `[TEST] Dawn offering ${stamp}`;
const READER = "editor@example.test";
let collectionId = "";
let prayerId = "";

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-collections-${name}.png`, fullPage: true });
};

async function as(browser: Browser, email: string, opts: { colorScheme?: "light" | "dark" } = {}): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use;
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL, colorScheme: opts.colorScheme });
  if (opts.colorScheme) await context.addCookies([{ name: "theme", value: opts.colorScheme, url: baseURL ?? "http://localhost:3100" }]);
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations, JSON.stringify(result.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql("delete from community.rate_events");
});

test.afterAll(async () => {
  await sql("delete from prayer.library_prayers where title like '[TEST] %'");
  await sql("delete from prayer.library_collections where name like '[TEST] %'");
});

test("a settings manager creates a collection with a cropped cover and previews its card", async ({ browser }) => {
  const admin = await as(browser, ADMIN);
  await admin.goto("/admin/prayer/library/collections");
  await admin.getByLabel("Name").fill(COLLECTION);
  await admin.getByLabel(/Short description/).fill("Prayers to begin the day.");
  await admin.getByRole("button", { name: "Create collection" }).click();
  await admin.waitForURL(/\/admin\/prayer\/library\/collections\/[0-9a-f-]{36}\?created=1$/);
  collectionId = admin.url().split("/collections/")[1].split("?")[0];

  const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 196, g: 160, b: 96 } } }).png().toBuffer();
  await admin.getByLabel(/Cover image/).setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  const crop = admin.getByRole("dialog", { name: "Crop the image" });
  await expect(crop).toBeVisible();
  await crop.getByRole("button", { name: "Use image" }).click();
  await admin.getByLabel(/Cover description/).fill("Warm morning light");
  const preview = admin.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByText(COLLECTION)).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(1);
  await admin.getByRole("button", { name: "Save collection" }).click();
  await expect(admin.getByText("Saved, with the new cover.")).toBeVisible();
  await shot(admin, "admin-editor");
  // Members can't open the admin pages.
  const member = await as(browser, MEMBER);
  await member.goto(`/admin/prayer/library/collections/${collectionId}`);
  await expect(member.getByRole("button", { name: "Save collection" })).toHaveCount(0);
});

test("a member publishes a prayer into the collection without leaving the editor", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/prayer/library/new");
  await page.getByLabel("Title").fill(TITLE);
  await page.getByRole("textbox", { name: "Prayer" }).fill("Lord, as the light comes, **meet us** here.");
  const picker = page.getByRole("group", { name: /Collection/ });
  const find = picker.getByRole("searchbox", { name: "Find a collection" });
  if (await find.count()) await find.fill(`Morning Prayers ${stamp}`);
  await picker.getByRole("radio", { name: new RegExp(COLLECTION.replace(/[[\]]/g, "\\$&")) }).check();
  await expect(page.getByRole("complementary", { name: "Preview" }).getByText(COLLECTION)).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Your prayer is published in the library.")).toBeVisible();
  prayerId = page.url().split("/prayer/library/")[1].split("?")[0];
  await expect(page.getByRole("link", { name: COLLECTION })).toHaveAttribute("href", `/prayer/library/collections/${collectionId}`);
});

test("another member browses collections, searches within one, and comes back to it from a prayer", async ({ browser }) => {
  const page = await as(browser, READER);
  await page.goto("/prayer/library");
  const folder = page.getByRole("link", { name: new RegExp(`${COLLECTION.replace(/[[\]]/g, "\\$&")}.*1 prayer`) });
  await expect(folder).toBeVisible();
  await expect(page.getByRole("link", { name: /All prayers.*prayers?/ }).first()).toBeVisible();
  await shot(page, "cards");
  await folder.click();
  await expect(page).toHaveURL(new RegExp(`/prayer/library/collections/${collectionId}$`));
  await expect(page.getByRole("heading", { level: 1, name: COLLECTION })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Prayer Library" })).toBeVisible();
  await expect(page.getByRole("article", { name: TITLE })).toBeVisible();

  // Search within the collection, then across every prayer.
  const search = page.getByRole("searchbox", { name: `Search ${COLLECTION}` });
  await search.fill("light comes");
  await search.press("Enter");
  await expect(page.getByRole("list", { name: /Search results.* in / }).getByRole("article", { name: TITLE })).toBeVisible();
  expect(page.url()).not.toContain("light");
  await page.getByText("All prayers", { exact: true }).click();
  await expect(page.getByRole("list", { name: /^Search results for “light comes”$/ }).getByRole("article", { name: TITLE })).toBeVisible();
  await page.getByText(`In ${COLLECTION}`, { exact: true }).click();
  await shot(page, "collection-search");

  // Open the prayer: it names its collection and goes back there, search included.
  await page.getByRole("article", { name: TITLE }).getByRole("link", { name: TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await page.getByRole("link", { name: `Back to ${COLLECTION}` }).click();
  await expect(page).toHaveURL(new RegExp(`/prayer/library/collections/${collectionId}$`));
  await expect(page.getByRole("searchbox", { name: `Search ${COLLECTION}` })).toHaveValue("light comes");
  await expect(page.getByRole("list", { name: /Search results/ }).getByRole("article", { name: TITLE })).toBeVisible();

  // A direct link works too.
  await page.goto(`/prayer/library/collections/${collectionId}`);
  await expect(page.getByRole("heading", { level: 1, name: COLLECTION })).toBeVisible();
});

test("phones and desktops in both themes: no sideways scrolling, and axe passes", async ({ browser }) => {
  for (const scheme of ["light", "dark"] as const) {
    const page = await as(browser, READER, { colorScheme: scheme });
    for (const path of ["/prayer/library", `/prayer/library/collections/${collectionId}`, "/prayer/library/new"]) {
      await page.goto(path);
      await noHorizontalScroll(page);
      await axe(page);
    }
    await page.goto("/prayer/library");
    const views = page.getByRole("navigation", { name: "Library views" });
    for (const name of ["Collections", "All prayers", "My prayers", "Saved"]) await expect(views.getByRole("link", { name, exact: true })).toBeInViewport();
    await shot(page, `library-${scheme}`);
    await page.context().close();
  }
});

test("moving the prayer out hides the collection from members; then it can be archived", async ({ browser }) => {
  const admin = await as(browser, ADMIN);
  await admin.goto(`/admin/prayer/library/collections/${collectionId}`);
  await admin.getByRole("checkbox", { name: new RegExp(TITLE.replace(/[[\]]/g, "\\$&")) }).check();
  await admin.getByLabel("Move selected to").selectOption({ label: "General prayers" });
  await admin.getByRole("button", { name: /^Move 1 prayer/ }).click();
  await expect(admin.getByText("Moved 1 prayer.")).toBeVisible();

  const reader = await as(browser, READER);
  await reader.goto("/prayer/library");
  await expect(reader.getByRole("link", { name: new RegExp(COLLECTION.replace(/[[\]]/g, "\\$&")) })).toHaveCount(0);
  await reader.goto(`/prayer/library/collections/${collectionId}`);
  await expect(reader.getByRole("heading", { level: 1, name: COLLECTION })).toHaveCount(0);
  await reader.goto(`/prayer/library/${prayerId}`);
  await expect(reader.getByRole("link", { name: "General prayers" })).toBeVisible();

  await admin.reload();
  await admin.getByRole("checkbox", { name: /I've reviewed the prayers/ }).check();
  await admin.getByRole("button", { name: "Archive collection" }).click();
  await expect(admin.getByText(/Archived\. Members no longer see it\./)).toBeVisible();
  const [row] = await sql<{ archived: boolean }>("select archived_at is not null as archived from prayer.library_collections where id = $1", [collectionId]);
  expect(row.archived).toBe(true);
});
