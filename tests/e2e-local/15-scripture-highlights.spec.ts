import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Scripture highlights (local stack only, migration 20261125000100): the
 * reader's verse selection (mouse, keyboard, and the phone's verse-selection
 * mode), all six colors, saving feedback, persistence across reloads and a
 * second signed-in session, partial recolor and removal, My Journal's
 * Scripture Highlights view in step with the reader, quick add to Memory
 * Verses with the passage and translation chosen, and privacy from another
 * member and an administrator.
 *
 * Every verse is synthetic (translation "SYH"). A licensed version ("LIH")
 * points at API.Bible with a synthetic key, so its text never loads here:
 * its highlight shows the reference with the unavailable state, and no
 * other translation in its place. Set HIGHLIGHT_SHOTS to save screenshots.
 */
const SHOTS = process.env.HIGHLIGHT_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
};

async function as(browser: Browser, email: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use;
  const page = await (await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL })).newPage();
  await signIn(page, email);
  return page;
}

const memberId = async () => (await sql<{ id: string }>("select id from public.profiles where email = $1", [MEMBER]))[0].id;
const colorOf = async (page: Page, verse: number) => {
  // :visible: Next keeps a previously visited page hidden in the DOM.
  await page.locator(`[data-verse="${verse}"]:visible`).waitFor();
  const mark = page.locator(`[data-verse="${verse}"]:visible mark`);
  return (await mark.count()) ? mark.getAttribute("data-color") : null;
};
const toolbar = (page: Page) => page.getByRole("toolbar");

/** Selects verses a–b: verse numbers on desktop, selection mode taps on a phone. */
async function select(page: Page, a: number, b: number) {
  if (test.info().project.name === "mobile") {
    const mode = page.getByRole("button", { name: "Select verses" });
    if ((await mode.getAttribute("aria-pressed")) !== "true") await mode.tap();
    for (const v of a === b ? [a] : [a, b]) {
      const verse = page.locator(`[data-verse="${v}"]:visible`);
      await verse.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
      // The center of the verse's widest line, in the visual viewport's
      // coordinates (the emulated phone's visual viewport can sit below the
      // layout viewport, which raw touch coordinates don't account for).
      const point = await verse.evaluate((el) => {
        const r = [...el.getClientRects()].sort((a, b) => b.width - a.width)[0];
        const vv = window.visualViewport;
        return { x: r.left + r.width / 2 - (vv?.offsetLeft ?? 0), y: r.top + r.height / 2 - (vv?.offsetTop ?? 0) };
      });
      await page.touchscreen.tap(point.x, point.y);
    }
  } else {
    await page.getByRole("button", { name: `Verse ${a}`, exact: true }).click();
    if (b !== a) await page.getByRole("button", { name: new RegExp(`^Verse ${b}\\b`) }).click();
  }
  await expect(toolbar(page)).toBeVisible();
}

async function pick(page: Page, color: string) {
  await toolbar(page).getByRole("button", { name: color, exact: true }).click();
  await expect(page.getByText(/saved\.$/).first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql(
    `insert into bible.translations (code, name, attribution, copyright, rights, rights_confirmed_at, status, text_version, verse_count)
     values ('SYH', 'Synthetic Highlight Version', 'Synthetic test text.', 'None', 'public_domain', now(), 'draft', 1, 0)
     on conflict (code) do nothing`,
  );
  const [{ id }] = await sql<{ id: string }>("select id from bible.translations where code = 'SYH'");
  for (let v = 1; v <= 8; v++) {
    await sql("insert into bible.verses (translation_id, book_code, chapter, verse, text) values ($1, 'JHN', 3, $2, $3) on conflict do nothing", [
      id,
      v,
      `Synthetic verse three ${v}, placeholder wording for highlight tests.`,
    ]);
  }
  await sql("update bible.translations set verse_count = 8, status = 'active' where id = $1", [id]);
  await sql(
    `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status, allow_cache, cache_days, tracking_required)
     values ('LIH', 'Licensed Highlight Synthetic', 'api', 'api_bible', 'synthetic-bible-id', 'API_BIBLE_KEY', 'licensed', now(), 'active', true, 1, true)
     on conflict (code) do nothing`,
  );
  // Each project starts clean for the member.
  await sql("delete from bible.highlights where profile_id = $1", [await memberId()]);
  await sql(
    `delete from memory.cards k using memory.passages p, bible.translations t
      where k.passage_id = p.id and p.translation_id = t.id and t.code = 'SYH' and k.profile_id = $1`,
    [await memberId()],
  );
});

test("highlights a range in each of six colors, recolors and removes part, and keeps it after reload", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/bible/read/SYH/JHN/3");
  await select(page, 1, 1);
  for (const c of ["Yellow", "Green", "Blue", "Pink", "Purple", "Orange"]) {
    if (!(await toolbar(page).isVisible())) await select(page, 1, 1);
    await pick(page, c);
    expect(await colorOf(page, 1)).toBe(c.toLowerCase());
  }
  await select(page, 2, 5);
  await pick(page, "Yellow");
  await select(page, 4, 6);
  await expect(toolbar(page)).toContainText("Mixed colors");
  await expect(toolbar(page).getByRole("button", { name: "Yellow", exact: true })).toHaveAttribute("aria-pressed", "mixed");
  await pick(page, "Blue");
  expect(await colorOf(page, 3)).toBe("yellow");
  expect(await colorOf(page, 6)).toBe("blue");
  await select(page, 3, 3);
  await toolbar(page).getByRole("button", { name: "Remove highlight" }).click();
  await expect(page.getByText(/saved\.$/).first()).toBeVisible();
  await shot(page, "reader");
  await page.reload();
  expect(await colorOf(page, 2)).toBe("yellow");
  expect(await colorOf(page, 3)).toBeNull();
  expect(await colorOf(page, 5)).toBe("blue");
  const n = await sql<{ n: string }>("select count(*) n from bible.highlights where profile_id = $1", [await memberId()]);
  expect(Number(n[0].n)).toBe(5); // 1, 2, 4, 5, 6: one row per verse
  await noHorizontalScroll(page);
});

test("keyboard: verse numbers, Shift+Arrow to extend, Escape to cancel", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "keyboard flow on desktop");
  const page = await as(browser, MEMBER);
  await page.goto("/bible/read/SYH/JHN/3");
  await page.getByRole("button", { name: "Verse 7", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar(page)).toContainText("John 3:7–8");
  await page.keyboard.press("Escape");
  await expect(toolbar(page)).toHaveCount(0);
});

test("another signed-in session sees the same highlights; another member and an administrator see none", async ({ browser }) => {
  const second = await as(browser, MEMBER);
  await second.goto("/bible/read/SYH/JHN/3");
  expect(await colorOf(second, 2)).toBe("yellow");
  for (const email of [ADMIN]) {
    const other = await as(browser, email);
    await other.goto("/bible/read/SYH/JHN/3");
    expect(await other.locator(".scripture mark").count()).toBe(0);
    await other.goto("/journal?view=highlights");
    await expect(other.getByText("No highlights yet").filter({ visible: true })).toBeVisible();
  }
});

test("My Journal shows the passages and stays in step with the reader", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/journal?view=highlights");
  const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /John 3:4–6/ }) });
  await expect(item).toContainText("Blue");
  await expect(item).toContainText("Synthetic verse three 5");
  await expect(item).toContainText("Synthetic verse three 4");
  await expect(item.getByRole("link", { name: "Open in Bible" })).toHaveAttribute("href", "/bible/read/SYH/JHN/3#v4");
  const axe = await new AxeBuilder({ page }).include("main").analyze();
  expect(axe.violations).toEqual([]);
  await shot(page, "journal");
  // Recolor here: the reader follows.
  await item.getByRole("button", { name: "Purple", exact: true }).click();
  await expect(page.getByRole("heading", { name: /John 3:4–6/ })).toBeVisible();
  await expect(page.getByText(/Purple highlight on John 3:4–6 saved/)).toBeVisible();
  const reader = await as(browser, MEMBER);
  await reader.goto("/bible/read/SYH/JHN/3");
  expect(await colorOf(reader, 5)).toBe("purple");
  // Filters and order.
  await page.getByLabel("Color", { exact: true }).selectOption("yellow");
  await expect(page.getByRole("heading", { name: /John 3:2 / })).toBeVisible();
  await expect(page.getByRole("heading", { name: /John 3:4–6/ })).toHaveCount(0);
  await page.getByLabel("Color", { exact: true }).selectOption("");
  await page.getByLabel("Order", { exact: true }).selectOption("bible");
  await expect(page.getByRole("main").getByRole("listitem").first()).toContainText("John 3:1");
  // Removing the last verses of a passage removes it from the collection.
  const p56 = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /John 3:4–6/ }) });
  await p56.getByRole("button", { name: "Remove highlight" }).click();
  await expect(page.getByRole("heading", { name: /John 3:4–6/ })).toHaveCount(0);
});

test("Add to Memory Verses opens creation with the passage and translation chosen, and offers the existing verse next time", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/bible/read/SYH/JHN/3");
  await select(page, 1, 2);
  await toolbar(page).getByRole("link", { name: "Add to Memory Verses" }).click();
  await expect(page).toHaveURL(/\/memory\/verses\/add\?/);
  await expect(page.getByText("From your highlight")).toBeVisible();
  await expect(page.getByRole("heading", { name: /John 3:1–2 \(SYH\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Add to My Verses" }).click();
  await expect(page).toHaveURL(/\/memory\/verses\/[0-9a-f-]{36}/);
  // The highlight stays.
  await page.goto("/bible/read/SYH/JHN/3");
  expect(await colorOf(page, 1)).not.toBeNull();
  // Again: the existing verse is offered instead of a second one.
  await select(page, 1, 2);
  await toolbar(page).getByRole("link", { name: "Add to Memory Verses" }).click();
  await expect(page.getByText(/is already in My Verses/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to My Verses" })).toHaveCount(0);
});

test("a licensed version's highlight keeps its reference when the text can't load, with no other translation shown", async ({ browser }) => {
  const id = await memberId();
  await sql(
    `insert into bible.highlights (profile_id, translation_id, book_code, chapter, verse, color)
     select $1, id, 'JHN', 3, 16, 'green' from bible.translations where code = 'LIH' on conflict do nothing`,
    [id],
  );
  const page = await as(browser, MEMBER);
  await page.goto("/journal?view=highlights");
  const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /John 3:16 \(LIH\)/ }) });
  await expect(item).toContainText(/isn't responding|can't be reached/);
  await expect(item.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(item.locator(".scripture")).toHaveCount(0);
  await shot(page, "licensed-unavailable");
});

test("adding a highlight in a version not permitted for memory explains why and shows no other version", async ({ browser }) => {
  const [{ id }] = await sql<{ id: string }>("select id from bible.translations where code = 'LIH'");
  const page = await as(browser, MEMBER);
  await page.goto(`/memory/verses/add?${new URLSearchParams({ t: id, book: "JHN", c: "3", from: "16", to: "16", source: "highlight" })}`);
  await expect(page.getByText(/LIH isn't confirmed for memory verses/)).toBeVisible();
  await expect(page.getByText(/no other version was chosen instead/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to My Verses" })).toHaveCount(0);
  await expect(page.locator(".scripture")).toHaveCount(0);
});
