import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Prayer Library (local stack only): a member drafts, previews, publishes,
 * edits, and archives a prayer; another member finds it by search and by
 * combined filters, reads it, saves it privately, copies it with its
 * attribution, and reports it; a prayer moderator hides and restores it
 * (direct links stop working while hidden). Also: the Prayer tabs scroll on
 * a phone, keyboard search, both themes, and prayer requests still load.
 * Everything here is synthetic and tagged [TEST]. Set LIBRARY_SHOTS to a
 * folder to save screenshots.
 */
const SHOTS = process.env.LIBRARY_SHOTS;
const stamp = Date.now() % 100000;
const TITLE = `[TEST] Table blessing ${stamp}`;
const READER = "editor@example.test";
let prayerId = "";

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
};

async function as(browser: Browser, email: string, opts: { colorScheme?: "light" | "dark" } = {}): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use;
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL, colorScheme: opts.colorScheme });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  // The app's own theme choice (a cookie) wins over the system setting.
  if (opts.colorScheme) await context.addCookies([{ name: "theme", value: opts.colorScheme, url: baseURL ?? "http://localhost:3100" }]);
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql("delete from community.rate_events");
  // The seeded super administrator moderates prayer only with an explicit role.
  await sql("insert into public.user_roles (user_id, role_key) select id, 'prayer_moderator' from public.profiles where email = $1 on conflict do nothing", [ADMIN]);
});

test.afterAll(async () => {
  await sql("delete from prayer.library_reports where prayer_id in (select id from prayer.library_prayers where title like '[TEST] %')");
  await sql("delete from prayer.library_prayers where title like '[TEST] %'");
  await sql("delete from public.user_roles where role_key = 'prayer_moderator' and user_id = (select id from public.profiles where email = $1)", [ADMIN]);
});

test("a member drafts, previews, and publishes a prayer from the Prayer page", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/prayer");
  const tabs = page.getByRole("navigation", { name: "Prayer views" });
  await expect(tabs.getByRole("link", { name: "Requests", exact: true })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Prayer Library" }).click();
  await expect(page).toHaveURL(/\/prayer\/library$/);
  await expect(tabs.getByRole("link", { name: "Prayer Library" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("searchbox", { name: "Search the Prayer Library" })).toBeVisible();
  await shot(page, "library-empty-or-list");

  await page.getByRole("link", { name: "Add a prayer" }).first().click();
  await expect(page.getByText(/Share prayers you wrote, or ones you have permission to share/)).toBeVisible();
  await page.getByLabel("Title").fill(TITLE);
  await page.getByRole("textbox", { name: "Prayer" }).fill("Bless this food, **Lord**, and the hands that made it.");
  await page.getByRole("checkbox", { name: "Family and children" }).check();
  await page.getByRole("checkbox", { name: "Gratitude" }).check();
  await page.getByRole("checkbox", { name: "Meals" }).check();
  await page.getByLabel(/Scripture references/).fill("ps 145:15-16");
  await expect(page.getByText("Psalms 145:15–16", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Shared from another author or source/ }).check();
  await page.getByLabel(/Original author or source/).fill("Traditional table grace");
  // The preview shows the attribution exactly as readers will see it.
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(preview.getByText("By Traditional table grace")).toBeVisible();
  await expect(preview.getByText("Shared by Synthetic Member")).toBeVisible();
  await shot(page, "composer");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Your draft is saved. Only you can see it.")).toBeVisible();
  prayerId = page.url().split("/prayer/library/")[1].split("?")[0];

  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Prayer" }).fill("Bless this food, **Lord**, and the hands that made it. Amen.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Your prayer is published in the library.")).toBeVisible();
  await expect(page.getByText("By Traditional table grace")).toBeVisible();
  await expect(page.getByText(/Shared in the library by you/)).toBeVisible();
  await shot(page, "detail-own");
});

test("another member finds it by search and combined filters, saves it privately, and copies it with attribution", async ({ browser }) => {
  const page = await as(browser, READER);
  await page.goto("/prayer/library");
  const card = page.getByRole("article", { name: TITLE });
  await expect(card).toBeVisible();

  // Combined filters (GET), then reset.
  await page.getByText("Filters", { exact: true }).click();
  const filters = page.getByRole("form", { name: "Filter prayers" });
  await filters.getByLabel("Purpose").selectOption({ label: "Gratitude" });
  await filters.getByLabel("Intended use").selectOption({ label: "Meals" });
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await page.waitForURL(/purpose=.*&use=/);
  const meals = page.url();
  await expect(page.getByRole("article", { name: TITLE })).toBeVisible();
  await filters.getByLabel("Intended use").selectOption({ label: "Worship services" });
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await page.waitForURL((u) => u.href !== meals);
  await expect(page.getByRole("article", { name: TITLE })).toHaveCount(0);
  await expect(page.locator("#main").getByText("No prayers match these filters")).toBeVisible();
  await page.locator("#main").getByRole("link", { name: "Reset filters" }).first().click();
  await expect(page).toHaveURL(/\/prayer\/library$/);

  // Keyboard-only search (POST: the words stay out of the address bar).
  const search = page.getByRole("searchbox", { name: "Search the Prayer Library" });
  await search.focus();
  await page.keyboard.type("traditional grace");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: /Search results/ }).getByRole("article", { name: TITLE })).toBeVisible();
  expect(page.url()).not.toContain("grace");
  await shot(page, "search");

  await page.getByRole("article", { name: TITLE }).getByRole("link", { name: TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.getByText("Shared in the library by Synthetic Member")).toBeVisible();
  await expect(page.getByRole("list", { name: "Scripture references" })).toContainText("Psalms 145:15–16");

  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("button", { name: /^Saved/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Copy prayer" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(TITLE);
  expect(copied).toContain("— Traditional table grace");
  expect(copied).toContain("Shared by Synthetic Member");
  expect(copied).toContain("Scripture: Psalms 145:15–16");

  await page.goto("/prayer/library?view=saved");
  await expect(page.getByRole("article", { name: TITLE })).toBeVisible();

  // Report it.
  await page.goto(`/prayer/library/${prayerId}`);
  await page.getByRole("button", { name: "Report this prayer" }).click();
  await page.getByRole("radio", { name: "Shared without permission" }).check();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thank you. A prayer moderator will review it.")).toBeVisible();
});

test("the contributor's bookmarks stay private to each member", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/prayer/library?view=saved");
  await expect(page.getByRole("article", { name: TITLE })).toHaveCount(0);
});

test("a prayer moderator hides it (links stop working) and restores it, with a reason", async ({ browser }) => {
  const mod = await as(browser, ADMIN);
  await mod.goto("/admin/prayer/library");
  await mod.getByRole("link", { name: new RegExp(`Shared without permission`) }).first().click();
  await expect(mod.getByText("Reported prayer (as it was when reported)")).toBeVisible();
  await mod.getByRole("button", { name: "Hide" }).click();
  const hide = mod.getByRole("dialog", { name: "Hide this prayer?" });
  await hide.getByLabel(/Reason/).fill("Checking permission with the contributor");
  await hide.getByRole("button", { name: "Hide" }).click();
  await expect(mod.getByText("Hidden. Members can no longer find or open it.")).toBeVisible();

  const reader = await as(browser, READER);
  await reader.goto(`/prayer/library/${prayerId}`);
  await expect(reader.getByRole("heading", { level: 1, name: TITLE })).toHaveCount(0);
  await reader.goto("/prayer/library?view=saved");
  await expect(reader.getByRole("article", { name: TITLE })).toHaveCount(0);

  const owner = await as(browser, MEMBER);
  await owner.goto(`/prayer/library/${prayerId}`);
  await expect(owner.getByText("Hidden by a prayer moderator")).toBeVisible();

  await mod.reload();
  await mod.getByRole("button", { name: "Restore" }).click();
  const restore = mod.getByRole("dialog", { name: "Restore this prayer?" });
  await restore.getByLabel(/Reason/).fill("Permission confirmed");
  await restore.getByRole("button", { name: "Restore" }).click();
  await expect(mod.getByText("Restored to the library.")).toBeVisible();
  await reader.goto(`/prayer/library/${prayerId}`);
  await expect(reader.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  const log = await sql<{ action: string }>("select action from prayer.moderation_log where target_id = $1 order by id", [prayerId]);
  expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["library_prayer.hide", "library_prayer.restore"]));
});

test("the contributor archives it and it leaves the library", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/prayer/library/${prayerId}`);
  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("dialog", { name: "Archive this prayer?" }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived. Only you can see it now.").first()).toBeVisible();
  const reader = await as(browser, READER);
  await reader.goto(`/prayer/library/${prayerId}`);
  await expect(reader.getByRole("heading", { level: 1, name: TITLE })).toHaveCount(0);
});

test("prayer requests still load, the tabs scroll on a phone, and both themes pass axe", async ({ browser }) => {
  for (const scheme of ["light", "dark"] as const) {
    const page = await as(browser, MEMBER, { colorScheme: scheme });
    await page.goto("/prayer");
    await expect(page.getByRole("link", { name: "Share a request" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Practical care" })).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto("/prayer/library");
    await noHorizontalScroll(page);
    const tabs = page.getByRole("navigation", { name: "Prayer views" });
    if (test.info().project.name === "mobile") {
      // The row scrolls instead of wrapping, and the current tab is in view.
      expect(await tabs.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await expect(tabs.getByRole("link", { name: "Prayer Library" })).toBeInViewport();
    }
    const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
    await shot(page, `library-${scheme}`);
    await page.goto("/prayer/library/new");
    const axeForm = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axeForm.violations, JSON.stringify(axeForm.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
    await page.context().close();
  }
});
