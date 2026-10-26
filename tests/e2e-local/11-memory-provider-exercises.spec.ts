import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * All six memory exercises for licensed versions (local stack only,
 * migration 20261125000100), against SYNTHETIC fixture text: the server
 * runs with API_BIBLE_FIXTURE_FILE=tests/fixtures/memory/api-bible-synthetic.json
 * (honoured only with a loopback Supabase) and a synthetic API_BIBLE_KEY,
 * so the real fetch, parse, cache, fingerprint, and FUMS-token paths run
 * without API.Bible or licensed wording. This is a fixture check, not a
 * live-provider check.
 *
 * FUMS: the tracker script is answered by a stub that records each
 * reported token, so display events can be counted. Set MEMORY_SHOTS to a
 * folder to save screenshots.
 */
const SHOTS = process.env.MEMORY_SHOTS;
const FUMS_SRC = "https://cdn.scripture.api.bible/fums/fumsv2.min.js";
const MARKER = "Synthetic fixture";
const ids: Record<string, string> = {};
let nasbCard = "";

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` });
};

async function as(browser: Browser, email: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use;
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL });
  await context.route(FUMS_SRC, (r) =>
    r.fulfill({ contentType: "application/javascript", body: "window._BAPI={t:function(id){(window.__fums=window.__fums||[]).push(id)}};" }),
  );
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

const fums = (page: Page) => page.evaluate(() => (window as unknown as { __fums?: string[] }).__fums ?? []);
/** Exactly `n` FUMS reports on this page, and still `n` a moment later (no late duplicates). */
async function reported(page: Page, n: number) {
  await expect.poll(() => fums(page)).toHaveLength(n);
  await page.waitForTimeout(400);
  expect(await fums(page)).toHaveLength(n);
}
const strip = (page: Page) => page.locator("[data-exercise-attribution]");

/** The strip is on screen, below the app header, and clear of the bottom dock and of `other`. */
async function attributionClear(page: Page, other?: ReturnType<Page["locator"]>) {
  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toContainText("NASB");
  await expect(strip(page).getByRole("button", { name: /Copyright notice/ })).toBeVisible();
  const box = (await strip(page).boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vh);
  const header = page.locator("[data-app-header]:visible").first();
  if (await header.count()) expect(box.y + 1).toBeGreaterThanOrEqual((await header.boundingBox())!.y + (await header.boundingBox())!.height);
  const dock = page.locator(".dock:visible").first();
  if (await dock.count()) expect(box.y + box.height).toBeLessThanOrEqual((await dock.boundingBox())!.y + 1);
  if (other) {
    const o = (await other.boundingBox())!;
    const overlaps = !(o.y >= box.y + box.height || o.y + o.height <= box.y);
    expect(overlaps).toBe(false);
  }
}

async function startActivity(page: Page, activity: string, label: RegExp) {
  await page.goto(`/memory/practice/${nasbCard}?activity=${activity}`);
  await page.getByRole("button", { name: label }).click();
  await expect(page.getByRole("heading", { level: 2, name: /·/ }).first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const api = async (code: string, name: string, ref: string) => {
    await sql(
      `insert into bible.translations (code, name, source_kind, provider, provider_ref, credential_env, rights, rights_confirmed_at, status, allow_cache, cache_days, tracking_required)
       values ($1, $2, 'api', 'api_bible', $3, 'API_BIBLE_KEY', 'licensed', now(), 'active', true, 1, true)
       on conflict (code) do update set provider_ref = excluded.provider_ref, status = 'active'`,
      [code, name, ref],
    );
    ids[code] = (await sql<{ id: string }>("select id from bible.translations where code = $1", [code]))[0].id;
    await sql(
      `insert into memory.provider_permissions (translation_id, unchanged_text, terms_note) values ($1, true, 'Synthetic local test: unchanged display checked.')
       on conflict (translation_id) do update set unchanged_text = true`,
      [ids[code]],
    );
  };
  await api("NASB", "New American Standard Bible 2020", "synthetic-nasb");
  await api("AMP", "Amplified Bible", "synthetic-amp");
  await api("NIV", "New International Version", "synthetic-niv");
  for (const code of ["NASB", "AMP"]) {
    await sql(
      `update memory.provider_permissions set exercise_modes = true, exercise_note = 'Synthetic local test: API.Bible clarification 2026-10-26.', exercise_confirmed_at = now(),
              publisher_approval_required = false where translation_id = $1`,
      [ids[code]],
    );
  }
  await sql("update memory.provider_permissions set exercise_modes = false, publisher_approval_required = true, publisher_approval_confirmed_at = null where translation_id = $1", [ids.NIV]);
  // Start each run with no earlier licensed cards for the member.
  await sql(
    "delete from memory.cards k using memory.passages p, public.profiles pr where p.id = k.passage_id and pr.id = k.profile_id and pr.email = $1 and p.source_kind = 'api'",
    [MEMBER],
  ).catch(() => {});
});

test("a member adds a licensed verse and sees the fixture text with its notice", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/memory/verses/add?t=${ids.NASB}&book=JHN&c=3&from=16&to=17`);
  await expect(page.getByText(MARKER).first()).toBeVisible();
  await expect(page.getByText(/all six activities are available/).first()).toBeVisible();
  await page.getByRole("button", { name: "Add to My Verses" }).click();
  await page.waitForURL(/\/memory\/verses\/[0-9a-f-]{36}$/);
  nasbCard = page.url().split("/").pop()!;
  await page.close();
});

test("all six activities run on the licensed text, with the abbreviation and notice on screen throughout", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  const mobile = test.info().project.name === "mobile";

  // Read & repeat: the text is on screen at once; one display event.
  await startActivity(page, "read_repeat", /Start read & repeat/i);
  await attributionClear(page);
  await expect(page.locator("#main").getByText("Synthetic", { exact: true }).first()).toBeVisible();
  await strip(page).getByRole("button", { name: /Copyright notice/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic fixture notice for NASB-shaped tests");
  await shot(page, "copyright-dialog");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await shot(page, "read-repeat");
  await page.getByRole("button", { name: "I'm done" }).click();
  await expect(page.getByRole("heading", { name: /^Saved/ })).toBeVisible();
  await attributionClear(page);
  await reported(page, 1);
  expect(await fums(page)).toEqual(["synthetic-fums-nasb"]);

  // Flashcards (reference practice: the verse is the front).
  await page.goto(`/memory/practice/${nasbCard}?activity=flashcards&direction=text_to_ref`);
  await page.getByText("Verse (say the reference)").click();
  await page.getByRole("button", { name: /Start flashcards/i }).click();
  await attributionClear(page);
  await page.getByRole("button", { name: "Flip the card" }).click();
  await page.getByText("Mostly", { exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: /^Saved/ })).toBeVisible();
  await reported(page, 1);

  // Missing words: hints and answers don't add display events.
  await startActivity(page, "missing_words", /Start missing words/i);
  await attributionClear(page);
  const blanks = page.locator("select[aria-label]");
  for (let i = 0; i < (await blanks.count()); i++) await blanks.nth(i).selectOption({ index: 1 });
  await shot(page, "missing-words");
  await page.getByRole("button", { name: "Check my answers" }).click();
  await expect(page.getByRole("heading", { name: /^Saved/ })).toBeVisible();
  await attributionClear(page);
  await reported(page, 1);

  // Word order: moving pieces never reports again.
  await startActivity(page, "word_order", /Start word order/i);
  await attributionClear(page);
  const pool = page.locator("section[aria-labelledby='order-pool'] button");
  // A hint places the next piece (and takes back a misplaced one), so ask first.
  await page.getByRole("button", { name: "Hint" }).click();
  while (await pool.count()) await pool.first().click();
  await shot(page, "word-order");
  await page.getByRole("button", { name: "Check the order" }).click();
  await expect(page.getByRole("heading", { name: /^Saved/ })).toBeVisible();
  await reported(page, 1);

  // Typed recall: the text appears with the first hint; the result shows the comparison.
  await startActivity(page, "type_verse", /Start type the verse/i);
  await page.waitForTimeout(500);
  expect(await fums(page)).toHaveLength(0);
  const box = page.getByRole("textbox").first();
  await box.fill("Synthetic fixture wording for verse sixteen");
  await page.getByRole("button", { name: "Next word" }).click();
  await expect(page.getByText("Next word:")).toBeVisible();
  await reported(page, 1);
  await attributionClear(page, box);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await page.getByRole("button", { name: "Check my verse" }).click();
  await expect(page.getByRole("heading", { name: /^Saved/ })).toBeVisible();
  await attributionClear(page);
  await shot(page, "typed-result");
  await reported(page, 1);

  // Self-check: the opening-words hint, then the reveal; one display event.
  await startActivity(page, "self_check", /Start self-check/i);
  await page.getByRole("button", { name: "Show how it begins" }).click();
  await expect(page.getByText("It begins:")).toBeVisible();
  await page.getByRole("button", { name: "Reveal the verse" }).click();
  await attributionClear(page);
  await page.getByText("Mostly", { exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: /^Saved/ })).toBeVisible();
  await reported(page, 1);
  expect(await fums(page)).toEqual(["synthetic-fums-nasb"]);

  // Practice again is a new display event.
  await startActivity(page, "read_repeat", /Start read & repeat/i);
  await page.getByRole("button", { name: "I'm done" }).click();
  await page.getByRole("button", { name: "Practice again" }).click();
  await expect(strip(page)).toBeVisible();
  await reported(page, 2);

  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  if (mobile) await noHorizontalScroll(page);
  await page.close();
});

test("on a small phone with large text and the keyboard open, the notice stays visible and clear of the controls", async ({ browser }) => {
  test.skip(test.info().project.name !== "mobile", "phone only");
  const page = await as(browser, MEMBER);
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => document.documentElement.style.setProperty("font-size", "150%"));
  });
  await startActivity(page, "type_verse", /Start type the verse/i);
  const box = page.getByRole("textbox").first();
  await box.focus();
  // The on-screen keyboard leaves about half of a small phone's height.
  await page.setViewportSize({ width: 360, height: 400 });
  await box.pressSequentially("Synthetic fixture wording");
  // Focus scrolling stops below the header and the strip (scroll-padding-top, set from their measured height).
  await box.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await attributionClear(page);
  const s = (await strip(page).boundingBox())!;
  const b = (await box.boundingBox())!;
  // The typing box starts below the strip and at least two lines of it are on screen.
  expect(b.y).toBeGreaterThanOrEqual(s.y + s.height - 1);
  expect(Math.min(b.y + b.height, 400) - b.y).toBeGreaterThan(48);
  await shot(page, "keyboard-large-text");
  // The check button, scrolled to, isn't covered either.
  const check = page.getByRole("button", { name: "Check", exact: true });
  await check.scrollIntoViewIfNeeded();
  await attributionClear(page, check);
  await page.close();
});

test("nothing from the practice text is kept in the browser or in practice records", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await startActivity(page, "missing_words", /Start missing words/i);
  const stored = await page.evaluate(async () => {
    const out: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    if ("databases" in indexedDB) out.push(JSON.stringify(await indexedDB.databases()));
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        urls.push(new URL(req.url).pathname);
        out.push(await (await cache.match(req))!.clone().text().catch(() => ""));
      }
    }
    return { text: out.join("\n"), urls };
  });
  expect(stored.text).not.toContain(MARKER);
  // The service worker keeps only static assets and the offline page.
  expect(stored.urls.filter((u) => !/^\/(_next\/static|brand|icons)\/|^\/offline\.html$/.test(u))).toEqual([]);
  const [{ t }] = await sql<{ t: string }>(
    `select coalesce(string_agg(x, ' '), '') t from (
       select to_jsonb(s)::text x from memory.sessions s join memory.passages p on p.id = s.passage_id where p.source_kind = 'api'
       union all select to_jsonb(a)::text from memory.attempts a
       union all select to_jsonb(p)::text from memory.passages p where p.source_kind = 'api') q`,
  );
  expect(t).not.toContain(MARKER);
  await page.close();
});

test("NIV keeps flashcards and self-check until its publisher approval is recorded", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one administrator flow is enough");
  const member = await as(browser, MEMBER);
  await member.goto(`/memory/verses/add?t=${ids.NIV}&book=JHN&c=3&from=16&to=17`);
  await member.getByRole("button", { name: "Add to My Verses" }).click();
  await member.waitForURL(/\/memory\/verses\/[0-9a-f-]{36}$/);
  const niv = member.url().split("/").pop()!;
  await member.goto(`/memory/practice/${niv}`);
  await expect(member.getByRole("radio")).toHaveCount(2);
  await expect(member.getByText(/flashcards and self-check/).first()).toBeVisible();
  await member.close();

  const admin = await as(browser, ADMIN);
  await admin.goto(`/admin/bible/sources/${ids.NIV}`);
  await expect(admin.getByText("NIV: publisher feature approval")).toBeVisible();
  await expect(admin.getByLabel("Offer all six memory exercises for NIV")).toBeDisabled();
  await admin.getByRole("heading", { name: "All six exercises" }).scrollIntoViewIfNeeded();
  await shot(admin, "admin-niv-controls");
  await admin.goto(`/admin/bible/sources/${ids.NASB}`);
  await expect(admin.getByLabel("Offer all six memory exercises for NASB")).toBeChecked();
  await admin.getByRole("heading", { name: "All six exercises" }).scrollIntoViewIfNeeded();
  await shot(admin, "admin-nasb-controls");
  await admin.close();
});

test("an outage or changed wording pauses practice and says so", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "states, not layout");
  const [{ id: profile }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [MEMBER]);
  // Rerunnable: drop this test's earlier synthetic cards and passages.
  const refs = ["AMP:JHN.3.16-3.17", "AMP:JHN.3.16-3.18"];
  await sql("delete from memory.cards where passage_id in (select id from memory.passages where translation_id = $1 and ref_key = any($2))", [ids.AMP, refs]);
  await sql("delete from memory.passages where translation_id = $1 and ref_key = any($2)", [ids.AMP, refs]);
  const card = async (ev: number, hash: string) => {
    const [{ id: passage }] = await sql<{ id: string }>(
      `insert into memory.passages (translation_id, book_code, start_chapter, start_verse, end_chapter, end_verse, label, ref_key, text_version, content_hash, version,
                                    word_count, source_kind, provider_passage_id, verse_numbers)
       values ($1, 'JHN', 3, 16, 3, $2::int, 'John 3:16-' || $2::int, 'AMP:JHN.3.16-3.' || $2::int, 0, $3, 1, 20, 'api', 'JHN.3.16-JHN.3.' || $2::int, '[[3,16]]') returning id`,
      [ids.AMP, ev, hash],
    );
    return (await sql<{ id: string }>("insert into memory.cards (profile_id, passage_id, due_on) values ($1, $2, current_date) returning id", [profile, passage]))[0].id;
  };
  const changed = await card(17, createHash("sha256").update("a different wording").digest("hex"));
  const missing = await card(18, createHash("sha256").update("never fetched").digest("hex"));
  const page = await as(browser, MEMBER);
  await page.goto(`/memory/practice/${changed}`);
  await expect(page.getByText(/has changed since you added it/)).toBeVisible();
  await expect(page.getByText("Your progress is kept, and no other version is used instead.")).toBeVisible();
  await shot(page, "changed-wording");
  await page.goto(`/memory/practice/${missing}`);
  await expect(page.getByText(/AMP is temporarily unavailable for memory practice/)).toBeVisible();
  await shot(page, "outage");
  await page.close();
});
