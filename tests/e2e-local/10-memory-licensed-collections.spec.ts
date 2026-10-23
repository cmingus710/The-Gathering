import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Licensed versions in memory collections (local stack only, migration
 * 20261109000100). Synthetic versions stand in for NIV, NASB, AMP: two with
 * their memory permission recorded, one without, one permitted but not
 * connected on this server (its key setting is unset), and a draft. The
 * server runs with API_BIBLE_KEY set to a synthetic value, so permitted
 * versions are offered, and every fetch from API.Bible fails here: the
 * pages show the outage state. No licensed text exists anywhere in this
 * test. Set MEMORY_SHOTS to a folder to save screenshots.
 */
const SHOTS = process.env.MEMORY_SHOTS;
const stamp = Date.now();
const NIV_TITLE = `[TEST] Fall verses (NIV) ${stamp}`;
/** The desktop run creates the collection; the phone run reuses the latest one. */
async function latestCollection() {
  if (nivCollection) return;
  const rows = await sql<{ id: string; item: string }>(
    `select c.id, i.id item from memory.collections c join memory.items i on i.collection_id = c.id
      where c.title like '[TEST] Fall verses (NIV)%' and c.status = 'published' order by c.created_at desc limit 1`,
  );
  if (rows[0]) [nivCollection, nivItem] = [rows[0].id, rows[0].item];
}
const WEB_TITLE = `[TEST] Public-domain verses ${stamp}`;
let niv = "";
let nivCollection = "";
let nivItem = "";

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
};

async function as(browser: Browser, email: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use;
  const page = await (await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL })).newPage();
  await signIn(page, email);
  return page;
}

const permit = (code: string, on: boolean) =>
  sql(
    `insert into memory.provider_permissions (translation_id, unchanged_text, terms_note)
     select id, $2, 'Synthetic local test: terms reviewed for memory verses.' from bible.translations where code = $1
     on conflict (translation_id) do update set unchanged_text = excluded.unchanged_text`,
    [code, on],
  );

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // Public-domain WEB with two stored verses (World English Bible, public domain).
  await sql(
    `insert into bible.translations (code, name, attribution, copyright, rights, rights_confirmed_at, status, text_version, verse_count)
     values ('WEB', 'World English Bible', 'World English Bible (WEB), public domain.', 'Public domain', 'public_domain', now(), 'draft', 1, 0)
     on conflict (code) do nothing`,
  );
  const [{ id: web }] = await sql<{ id: string }>("select id from bible.translations where code = 'WEB'");
  await sql(
    `insert into bible.verses (translation_id, book_code, chapter, verse, text) values
       ($1, 'JHN', 3, 16, 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.'),
       ($1, 'JHN', 3, 17, 'For God didn''t send his Son into the world to judge the world, but that the world should be saved through him.')
     on conflict do nothing`,
    [web],
  );
  await sql("update bible.translations set verse_count = 2, status = 'active' where id = $1", [web]);
  await sql("update bible.settings set default_translation_id = $1", [web]);
  const api = (code: string, name: string, status: string, env = "API_BIBLE_KEY") =>
    sql(
      `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status, allow_cache, cache_days, tracking_required)
       values ($1, $2, 'api', 'api_bible', 'synthetic-bible-id', $4, 'licensed', now(), $3::bible.translation_status, true, 1, true)
       on conflict (code) do nothing`,
      [code, name, status, env],
    );
  await api("NIV", "New International Version", "active");
  await api("NASB", "New American Standard Bible 2020", "active");
  await api("AMP", "Amplified Bible", "active");
  await api("CSB", "Christian Standard Bible", "active", "CSB_SYNTHETIC_KEY");
  await api("NLT", "New Living Translation", "draft");
  await permit("NIV", true);
  await permit("NASB", true);
  await permit("CSB", true);
  await sql("delete from memory.provider_permissions where translation_id = (select id from bible.translations where code = 'AMP')");
  [{ id: niv }] = await sql<{ id: string }>("select id from bible.translations where code = 'NIV'");
});

test.afterAll(async () => {
  await permit("NIV", true);
});

test("administrators choose an eligible licensed version; others are disabled with the reason", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one administrator flow is enough");
  const page = await as(browser, ADMIN);
  await page.goto("/admin/memory/collections/new");
  const select = page.getByLabel("Bible version", { exact: true });
  const enabled = await select.locator("option:not([disabled])").allTextContents();
  const disabled = await select.locator("option[disabled]").allTextContents();
  expect(enabled.join("|")).toMatch(/New International Version \(NIV\): licensed, flashcards and self-check only/);
  expect(enabled.join("|")).toMatch(/NASB/);
  expect(enabled.join("|")).toMatch(/World English Bible \(WEB\)/);
  expect(disabled.join("|")).toMatch(/AMP\): not confirmed for memory verses/);
  expect(disabled.join("|")).toMatch(/CSB\): not connected on this server/);
  expect([...enabled, ...disabled].join("|")).not.toMatch(/NLT/);
  await expect(page.getByText("AMP isn't confirmed for memory verses.", { exact: false })).toBeVisible();
  await page.getByLabel("Title").fill(NIV_TITLE);
  await select.selectOption({ label: "New International Version (NIV): licensed, flashcards and self-check only" });
  await expect(page.getByText(/NIV is licensed: its text is fetched from API.Bible when shown and never stored here/)).toBeVisible();
  await shot(page, "admin-new-collection-licensed");
  await page.getByRole("button", { name: "Create collection" }).click();
  await page.waitForURL(/\/admin\/memory\/collections\/[0-9a-f-]{36}$/);
  nivCollection = page.url().split("/").pop()!;
  await expect(page.getByText("NIV is a licensed version.")).toBeVisible();

  // Adding a verse fetches it from API.Bible, which isn't reachable here: nothing is added, nothing substituted.
  await page.getByLabel("Chapter", { exact: true }).fill("3");
  await page.getByLabel("From verse").fill("16");
  await page.getByRole("button", { name: "Add verse" }).click();
  await expect(page.getByText(/NIV is temporarily unavailable for memory practice\. Try again later; no other version is used instead\. Nothing was changed\./)).toBeVisible({ timeout: 20_000 });
  await shot(page, "admin-add-verse-outage");

  // A verse as the app's fetch would have added it (reference, passage ID, verse numbers, word count, fingerprint; no text).
  const fingerprint = createHash("sha256").update(`synthetic-${stamp}`).digest("hex");
  const [{ id: passage }] = await sql<{ id: string }>(
    `insert into memory.passages (translation_id, book_code, start_chapter, start_verse, end_chapter, end_verse, label, ref_key, text_version, content_hash, version,
                                  word_count, source_kind, provider_passage_id, verse_numbers)
     values ($1, 'JHN', 3, 16, 3, 16, 'John 3:16', 'NIV:JHN.3.16-3.16', 0, $2, 1, 25, 'api', 'JHN.3.16', '[[3,16]]') returning id`,
    [niv, fingerprint],
  );
  [{ id: nivItem }] = await sql<{ id: string }>(
    "insert into memory.items (collection_id, passage_id, position, title, starts_on, ends_on) values ($1, $2, 1, 'God''s love', current_date - 1, current_date + 6) returning id",
    [nivCollection, passage],
  );
  await page.reload();
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText("Published. Members can see it now.")).toBeVisible();
  await expect(page.getByText(/Licensed version: members see it exactly as published, with flashcards and self-check/)).toBeVisible();
  await page.getByRole("link", { name: /Show the text/ }).first().click();
  await expect(page.getByText(/NIV is temporarily unavailable for memory practice/)).toBeVisible({ timeout: 20_000 });
  await shot(page, "admin-licensed-collection");

  await page.goto(`/admin/memory/collections/${nivCollection}/preview`);
  await expect(page.getByText(/Not offered for NIV: read & repeat, missing words, word order/i)).toBeVisible();
  await shot(page, "admin-licensed-preview");
  await page.close();
});

test("members practice an assigned licensed verse only in its permitted modes, and see outages plainly", async ({ browser }) => {
  await latestCollection();
  test.skip(!nivCollection, "needs the administrator flow");
  await sql("delete from memory.cards where item_id = $1 and profile_id = (select id from public.profiles where email = $2)", [nivItem, MEMBER]).catch(() => {});
  const page = await as(browser, MEMBER);
  await page.goto(`/memory/collections/${nivCollection}`);
  await expect(page.getByText(/New International Version \(NIV\) is licensed: each verse is shown exactly as published/)).toBeVisible();
  await expect(page.getByText(/NIV is temporarily unavailable for memory practice/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Add to My Verses" }).click();
  // The page refreshes with the new card in place of the button.
  await expect(page.getByRole("link", { name: "Practice", exact: true })).toBeVisible();
  await shot(page, "member-collection");
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await noHorizontalScroll(page);

  // The verse page: the outage pauses practice; nothing else is shown instead.
  const [{ id: card }] = await sql<{ id: string }>(
    "select k.id from memory.cards k join public.profiles p on p.id = k.profile_id where p.email = $1 and k.item_id = $2",
    [MEMBER, nivItem],
  );
  await page.goto(`/memory/verses/${card}`);
  await expect(page.locator("#main").getByText(/NIV is temporarily unavailable for memory practice/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Practice now" })).toHaveCount(0);
  await shot(page, "member-verse-outage");
  // Gated modes stay refused by the server, whatever the browser asks for.
  const res = await page.request.post("/api/memory/sessions", { data: { card_id: card, activity: "missing_words", difficulty: "guided", segment: 0 } });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  await page.close();
});

test("withdrawing the permission pauses practice, keeps progress, and says why", async ({ browser }) => {
  await latestCollection();
  test.skip(!nivCollection, "needs the administrator flow");
  await permit("NIV", false);
  try {
    const page = await as(browser, MEMBER);
    await page.goto(`/memory/collections/${nivCollection}`);
    await expect(page.getByText("Memory practice in NIV isn't available right now.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Practice paused/ })).toBeVisible();
    await shot(page, "member-collection-withdrawn");
    await page.close();
    if (test.info().project.name === "desktop") {
      const admin = await as(browser, ADMIN);
      await admin.goto(`/admin/memory/collections/${nivCollection}`);
      await expect(admin.getByText("Memory practice in NIV isn't available right now.")).toBeVisible();
      await expect(admin.getByRole("heading", { name: "Add a verse" })).toHaveCount(0);
      await shot(admin, "admin-collection-withdrawn");
      await admin.close();
    }
  } finally {
    await permit("NIV", true);
  }
});

test("public-domain collections work as before", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one administrator flow is enough");
  const page = await as(browser, ADMIN);
  await page.goto("/admin/memory/collections/new");
  await page.getByLabel("Title").fill(WEB_TITLE);
  await page.getByLabel("Bible version", { exact: true }).selectOption({ label: "World English Bible (WEB)" });
  await page.getByRole("button", { name: "Create collection" }).click();
  await page.waitForURL(/\/admin\/memory\/collections\/[0-9a-f-]{36}$/);
  await page.getByLabel("Chapter", { exact: true }).fill("3");
  await page.getByLabel("From verse").fill("16");
  await page.getByRole("button", { name: "Add verse" }).click();
  await expect(page.getByRole("heading", { name: "1. John 3:16 (WEB)" })).toBeVisible();
  await page.getByRole("link", { name: "Preview activities" }).click();
  await expect(page.getByRole("heading", { name: "What a member sees" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Missing words" })).toBeVisible();
  await page.close();
});

test.afterAll(async () => {
  if (test.info().project.name !== "mobile") return; // the last project cleans up
  // Best effort: archived test collections are harmless if something else holds on to them.
  await sql("delete from memory.cards where item_id in (select i.id from memory.items i join memory.collections c on c.id = i.collection_id where c.title like '[TEST] %')").catch(() => {});
  await sql("delete from memory.collections where title like '[TEST] %'").catch(() => {});
});
