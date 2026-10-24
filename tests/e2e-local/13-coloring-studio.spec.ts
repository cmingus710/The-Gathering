import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { DB_URL, MEMBER, SEED_PASSWORD, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Bible Coloring Studio, signed in against the local stack: the editor's
 * demonstration drafts and SVG checks, then a guardian coloring for two
 * children on desktop and on a phone (Pixel 7 emulation): tap-to-fill,
 * brush (mouse, touch, and stylus), eraser, undo/redo, start over, zoom and
 * pan, autosave and reopen, child switching, a dropped connection, a second
 * device, export, keyboard filling, sign-out cleanup, and refusals for
 * people who may not color for the child.
 *
 * Note: this suite approves a synthetic youth policy, so run it after
 * 03-events-giving-youth (which checks that none is approved).
 */
test.describe.configure({ mode: "serial" });

const EDITOR = "editor@example.test";
const FAMILY_ADMIN = "col.family@example.test";
const POLICY_A = "col.policya@example.test";
const POLICY_B = "col.policyb@example.test";
const SUMMARY_ONLY = "col.summary@example.test";
const STRANGER = "col.stranger@example.test";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const EDITOR_ID = "22222222-2222-4222-8222-222222222222";
const NOAH = "Demo draft: Noah's rainbow";
const SKY_HEX = "#4fc3f7";
const ALL = { manage_profile: true, register: true, sign_forms: true, media_consent: true, view_progress: true, practice: true, manage_account: true, receive_updates: true };

type Json = Record<string, unknown>;
let activity = "";
let kidA = "";
let kidB = "";

async function rpcAs<T = Json>(user: string, fn: string, args: unknown[] = []): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    const r = await client.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args);
    await client.query("commit");
    return r.rows[0].r as T;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
}

async function ensureUser(email: string, name: string): Promise<string> {
  const found = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
  if (found.length) return found[0].id;
  const [{ id }] = await sql<{ id: string }>(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                             created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change,
                             email_change_token_current, reauthentication_token, phone_change, phone_change_token)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
             extensions.crypt($2, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
             jsonb_build_object('full_name', $3::text), now(), now(), '', '', '', '', '', '', '', '')
     returning id`,
    [email, SEED_PASSWORD, name],
  );
  await sql(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true), 'email', now(), now(), now())`,
    [id, email],
  );
  await sql("update public.profiles set membership_status = 'approved' where id = $1", [id]);
  return id;
}

async function ensureFamily() {
  const fam = await ensureUser(FAMILY_ADMIN, "Synthetic Family Admin");
  const pa = await ensureUser(POLICY_A, "Synthetic Policy A");
  const pb = await ensureUser(POLICY_B, "Synthetic Policy B");
  const summary = await ensureUser(SUMMARY_ONLY, "Synthetic Summary Guardian");
  await ensureUser(STRANGER, "Synthetic Stranger");
  for (const [who, role] of [[fam, "family_admin"], [pa, "youth_policy_admin"], [pb, "youth_policy_admin"], [EDITOR_ID, "youth_activity_editor"]]) {
    await sql("insert into public.user_roles (user_id, role_key) values ($1, $2) on conflict do nothing", [who, role]);
  }
  if (!(await sql("select 1 from youth.policies where status = 'approved'")).length) {
    const p = await rpcAs<Json>(pa, "youth_admin_policy_save", [null, JSON.stringify({
      title: "Synthetic policy", body: "Synthetic.",
      settings: { multiple_guardians: true, birth_date_required: false, independent_accounts: false, eligibility_rule: "Synthetic rule.", guardian_authorization_required: true, progress_sharing: "youth_choice" },
    })]);
    await rpcAs(pb, "youth_admin_policy_approve", [p.id, `approve version ${p.version}`, "Synthetic minutes"]);
  }
  const child = async (name: string) => {
    const found = await sql<{ id: string }>("select c.id from youth.children c join youth.guardianships g on g.child_id = c.id where c.display_name = $1 and g.guardian_id = $2", [name, MEMBER_ID]);
    if (found.length) return found[0].id;
    const r = await rpcAs<Json>(MEMBER_ID, "youth_guardian_request", [JSON.stringify({ kind: "new_child", child_name: name, relationship: "parent" })]);
    return (await rpcAs<Json>(fam, "youth_admin_request_decide", [r.id, JSON.stringify({ decision: "approve", verification_method: "in_person", permissions: ALL })])).child_id as string;
  };
  kidA = await child("Synthetic Ada");
  kidB = await child("Synthetic Ben");
  if (!(await sql("select 1 from youth.guardianships where guardian_id = $1 and child_id = $2", [summary, kidA])).length) {
    const r = await rpcAs<Json>(summary, "youth_guardian_request", [JSON.stringify({ kind: "existing_child", child_name: "Synthetic Ada", relationship: "parent" })]);
    await rpcAs(fam, "youth_admin_request_decide", [r.id, JSON.stringify({ decision: "approve", verification_method: "in_person", permissions: { view_progress: true, receive_updates: true }, child_id: kidA })]);
  }
}

/** The demonstration drafts, added through the editor's own button, with Noah's rainbow published. */
async function ensureNoah(browser: Browser) {
  const find = () => sql<{ id: string; status: string }>("select a.id, a.status from youth.activities a join youth.activity_versions v on v.activity_id = a.id where v.title = $1 limit 1", [NOAH]);
  if (!(await find()).length) {
    const page = await browser.newPage();
    await signIn(page, EDITOR);
    await page.goto("/admin/youth/activities");
    await page.getByRole("button", { name: "Add demonstration coloring drafts" }).click();
    await expect(page.getByText(/demonstration drafts/i).first()).toBeVisible();
    await page.close();
  }
  const [a] = await find();
  if (a.status !== "published") await rpcAs(EDITOR_ID, "youth_admin_activity_status", [a.id, "publish", "publish"]);
  activity = a.id;
}

const status = (page: Page) => page.getByTestId("coloring-status");
const surface = (page: Page) => page.getByTestId("coloring-surface");
const fillOf = (page: Page, region: number) => surface(page).locator("svg").first().locator("path").nth(region - 1);

/** A point in picture units (1000 × 750 for the demonstrations) → page coordinates. */
async function at(page: Page, ux: number, uy: number) {
  await surface(page).scrollIntoViewIfNeeded();
  const box = (await surface(page).boundingBox())!;
  return { x: box.x + (ux / 1000) * box.width, y: box.y + (uy / 750) * box.height };
}

async function tapAt(page: Page, ux: number, uy: number) {
  const p = await at(page, ux, uy);
  if (test.info().project.name === "mobile") await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  if (test.info().project.name === "mobile") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  }
}

async function artwork(child: string) {
  const rows = await sql<{ doc: { fills: Record<string, string>; strokes: Array<Record<string, string>> }; revision: number; last_operator_id: string }>(
    "select w.doc, w.revision, w.last_operator_id from youth.coloring_artwork w join youth.activities a on a.published_version_id = w.version_id where w.child_id = $1 and w.activity_id = $2",
    [child, activity],
  );
  return rows[0] ?? null;
}

async function open(page: Page, child: string) {
  await page.goto(`/youth/play/${activity}?child=${child}`);
  await expect(surface(page)).toBeVisible();
  await expect(status(page)).toBeVisible();
}

async function member(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(test.info().project.use);
  const page = await context.newPage();
  await signIn(page, MEMBER);
  return { context, page };
}

const saved = (page: Page) => expect(status(page)).toHaveText(/Saved/, { timeout: 15_000 });

test.beforeAll(async ({ browser }) => {
  await ensureFamily();
  await ensureNoah(browser);
  // Each project starts from blank pictures.
  await sql("delete from youth.coloring_artwork where child_id = any($1::uuid[])", [[kidA, kidB]]);
});

test("editor: demonstration drafts, refused and accepted SVGs, and a preview that saves nothing", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "the editor flow runs once");
  const page = await browser.newPage();
  await signIn(page, EDITOR);
  await page.goto("/admin/youth/activities");
  await page.getByRole("button", { name: "Add demonstration coloring drafts" }).click();
  await expect(page.getByText("The demonstration drafts are already here.")).toBeVisible();
  await page.getByRole("link", { name: "Demo draft: A shepherd and his sheep" }).click();
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Coloring picture" }) });
  await expect(section.getByText(/Tap-to-fill · \d+ parts/).first()).toBeVisible();

  const upload = async (name: string, svg: string) => {
    await section.getByLabel("SVG file").setInputFiles({ name, mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
    await section.getByLabel(/I confirm this artwork is original/).check();
    await section.getByRole("button", { name: "Check and preview" }).click();
  };
  await upload("evil.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><script>alert(2)</script><image href="https://example.test/x.png"/><rect data-region="Box" width="50" height="50"/></svg>');
  await expect(section.getByText("This SVG can't be used as a tap-to-fill coloring picture.")).toBeVisible();
  await expect(section.getByText(/contains scripts/)).toBeVisible();
  await expect(section.getByText(/event handler/)).toBeVisible();
  await expect(section.getByText(/embedded or linked images/)).toBeVisible();
  await upload("photo.svg", "\u0089PNG\r\n\u001a\nnot really");
  await expect(section.getByText(/isn't an SVG file/)).toBeVisible();

  await upload("ok.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect data-region="Sky" width="800" height="400" fill="#fff" stroke="#000" stroke-width="4"/><rect data-region="Grass" y="400" width="800" height="200" fill="#fff" stroke="#000" stroke-width="4"/></svg>');
  await expect(section.getByText(/Checked: 2 fillable parts/)).toBeVisible();
  await section.getByRole("button", { name: /Replace the draft's picture with this one/ }).click();
  await expect(page.getByText(/Coloring picture saved to draft version/)).toBeVisible();
  await expect(section.getByText("Tap-to-fill · 2 parts").first()).toBeVisible();
  await page.screenshot({ path: "test-results/local/coloring-editor-desktop.png", fullPage: true });

  await page.getByRole("link", { name: "Preview" }).first().click();
  await expect(status(page)).toHaveText(/Preview: nothing is saved/);
  await tapAt(page, 500, 100);
  await expect(fillOf(page, 1)).toHaveAttribute("fill", "#e53935");
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gathering.coloring")))).toEqual([]);
  await page.close();
});

test("guardian: fill, brush, eraser, undo, redo, start over, autosave, and reopen", async ({ browser }) => {
  const { context, page } = await member(browser);
  await open(page, kidA);
  await expect(page.getByRole("heading", { name: /The story: Noah and the rainbow/ })).toBeVisible();
  await expect(page.getByText(/God put a rainbow in the clouds/)).toBeVisible();
  await expect(status(page)).toHaveText(/Saves as you color/);

  // Tap-to-fill: Sky blue on the sky.
  await page.getByRole("button", { name: "Sky blue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sky blue", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tapAt(page, 500, 75);
  await expect(fillOf(page, 1)).toHaveAttribute("fill", SKY_HEX);
  await saved(page);
  expect((await artwork(kidA))!.doc.fills).toEqual({ r1: "sky" });
  expect((await artwork(kidA))!.last_operator_id).toBe(MEMBER_ID);

  // Brush, then eraser (strokes only).
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  await page.getByRole("button", { name: "Red", exact: true }).click();
  await drag(page, [150, 300], [350, 320]);
  await saved(page);
  await expect.poll(async () => (await artwork(kidA))!.doc.strokes.length).toBe(1);
  expect((await artwork(kidA))!.doc.strokes[0]).toMatchObject({ t: "paint", c: "red", s: "l" });
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await drag(page, [200, 310], [260, 310]);
  await expect.poll(async () => (await artwork(kidA))!.doc.strokes.map((s) => s.t)).toEqual(["paint", "erase"]);
  expect((await artwork(kidA))!.doc.fills).toEqual({ r1: "sky" }); // the eraser never touches fills

  // Undo and redo cover strokes and fills alike.
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await artwork(kidA))!.doc.strokes.length).toBe(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(fillOf(page, 1)).toHaveAttribute("fill", "#ffffff");
  await page.getByRole("button", { name: "Redo" }).click();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(fillOf(page, 1)).toHaveAttribute("fill", SKY_HEX);
  await expect.poll(async () => (await artwork(kidA))!.doc.strokes.length).toBe(1);

  // Start over asks first, and can itself be undone.
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("This clears all the coloring on this picture for Synthetic Ada");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(fillOf(page, 1)).toHaveAttribute("fill", SKY_HEX);
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Yes, start over" }).click();
  await expect(fillOf(page, 1)).toHaveAttribute("fill", "#ffffff");
  await expect.poll(async () => (await artwork(kidA))!.doc).toEqual({ fills: {}, strokes: [] });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(fillOf(page, 1)).toHaveAttribute("fill", SKY_HEX);
  await saved(page);

  // Stay inside the lines: a stroke that starts in the sky keeps to the sky.
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await page.getByRole("switch", { name: /Stay inside the lines/ }).check();
  await drag(page, [500, 60], [500, 400]);
  await expect.poll(async () => (await artwork(kidA))!.doc.strokes.at(-1)?.r).toBe("r1");

  // Reopen: the picture is as it was saved.
  await page.reload();
  await expect(fillOf(page, 1)).toHaveAttribute("fill", SKY_HEX);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await noHorizontalScroll(page);
  await context.close();
});

test("guardian: keyboard filling from the parts list", async ({ browser }) => {
  const { context, page } = await member(browser);
  await open(page, kidA);
  await page.getByRole("button", { name: "Purple", exact: true }).click();
  await page.getByText(/Parts of the picture \(\d+\): fill with the keyboard/).click();
  const sun = page.getByRole("button", { name: /^Sun/ });
  await sun.focus();
  await page.keyboard.press("Enter");
  await expect(sun).toContainText("Purple");
  await expect(fillOf(page, 8)).toHaveAttribute("fill", "#8e44ad");
  await saved(page);
  expect((await artwork(kidA))!.doc.fills.r8).toBe("purple");
  // Progress and coloring live side by side: marking it finished refreshes the page without disturbing the picture.
  await page.getByRole("button", { name: "Mark finished" }).click();
  await expect(page.getByText("Marked finished for Synthetic Ada.")).toBeVisible();
  await expect(page.getByText(/Restored changes from this device/)).toHaveCount(0);
  await expect(fillOf(page, 8)).toHaveAttribute("fill", "#8e44ad");
  await expect(status(page)).toHaveText(/Saved/);
  await page.getByRole("button", { name: "Mark not finished" }).click();
  await expect(page.getByText("Marked not finished for Synthetic Ada.")).toBeVisible();
  await context.close();
});

test("guardian: switching children keeps each child's picture separate", async ({ browser }) => {
  const { context, page } = await member(browser);
  await open(page, kidA);
  await page.getByRole("link", { name: "Synthetic Ben" }).click();
  await expect(page).toHaveURL(new RegExp(`child=${kidB}`));
  await expect(fillOf(page, 1)).toHaveAttribute("fill", "#ffffff");
  await page.getByRole("button", { name: "Green", exact: true }).click();
  await tapAt(page, 500, 725); // the water
  await saved(page);
  expect((await artwork(kidB))!.doc.fills).toEqual({ r13: "green" });
  await page.getByRole("link", { name: "Synthetic Ada" }).click();
  await expect(page).toHaveURL(new RegExp(`child=${kidA}`));
  await expect(fillOf(page, 1)).toHaveAttribute("fill", SKY_HEX);
  await expect(fillOf(page, 13)).toHaveAttribute("fill", "#ffffff");
  await context.close();
});

test("guardian: a dropped connection keeps the coloring on the device and saves when it's back", async ({ browser }) => {
  const { context, page } = await member(browser);
  await open(page, kidA);
  const before = (await artwork(kidA))!.revision;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Orange", exact: true }).click();
  await tapAt(page, 500, 137); // the outside rainbow stripe
  await expect(status(page)).toHaveText(/Unable to save/, { timeout: 15_000 });
  await expect(status(page)).toContainText("kept on this device");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gathering.coloring.v1:")));
  expect(keys).toEqual([expect.stringContaining(`:${MEMBER_ID}:${kidA}:`)]);
  await context.setOffline(false);
  await saved(page);
  expect((await artwork(kidA))!.doc.fills.r2).toBe("orange");
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gathering.coloring.v1:")))).toEqual([]);

  // Closed while offline: the next visit restores the device copy and saves it.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Yellow", exact: true }).click();
  await tapAt(page, 137, 125); // the sun
  await expect(status(page)).toHaveText(/Unable to save/, { timeout: 15_000 });
  await page.close({ runBeforeUnload: false });
  await context.setOffline(false);
  const again = await context.newPage();
  await open(again, kidA);
  await expect(again.getByText(/Restored changes from this device/)).toBeVisible();
  await saved(again);
  expect((await artwork(kidA))!.doc.fills.r8).toBe("yellow");
  expect((await artwork(kidA))!.revision).toBeGreaterThan(before);
  await context.close();
});

test("guardian: a second device never silently overwrites newer work", async ({ browser }) => {
  const one = await member(browser);
  const two = await member(browser);
  await open(one.page, kidA);
  await open(two.page, kidA);
  await two.page.getByRole("button", { name: "Pink", exact: true }).click();
  await tapAt(two.page, 500, 725);
  await saved(two.page);
  await one.page.getByRole("button", { name: "Blue", exact: true }).click();
  await tapAt(one.page, 500, 725);
  await expect(one.page.getByRole("alert").filter({ hasText: "saved on another device or tab" })).toBeVisible({ timeout: 15_000 });
  await expect(status(one.page)).toHaveText(/Unable to save: changed on another device/);
  expect((await artwork(kidA))!.doc.fills.r13).toBe("pink");
  await one.page.getByRole("button", { name: "Keep mine" }).click();
  await saved(one.page);
  expect((await artwork(kidA))!.doc.fills.r13).toBe("blue");
  await one.context.close();
  await two.context.close();
});

test("guardian: zoom and pan are separate from drawing, and the page still scrolls", async ({ browser }) => {
  const { context, page } = await member(browser);
  await open(page, kidA);
  const strokes = (await artwork(kidA))!.doc.strokes.length;
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await expect(page.locator("p", { hasText: /^View/ })).toContainText("100%");
  if (test.info().project.name === "mobile") {
    // Two fingers zoom; the stroke the first finger started is cancelled.
    const box = (await surface(page).boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 30, y: cy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 30 - i * 8, y: cy, id: 1 }, { x: cx + 30 + i * 8, y: cy, id: 2 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    // Ctrl + scroll zooms over the picture.
    const box = (await surface(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
  }
  await expect(page.locator("p", { hasText: /^View/ })).not.toContainText("100%");
  await page.waitForTimeout(2000);
  expect((await artwork(kidA))!.doc.strokes.length).toBe(strokes);
  // The Move tool pans without drawing.
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await drag(page, [500, 375], [300, 375]);
  await page.waitForTimeout(2000);
  expect((await artwork(kidA))!.doc.strokes.length).toBe(strokes);
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(page.locator("p", { hasText: /^View/ })).toContainText("100%");
  // Only the picture captures touch; the page scrolls.
  expect(await surface(page).evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
  expect(await page.evaluate(() => getComputedStyle(document.body).touchAction)).not.toBe("none");
  if (test.info().project.name === "desktop") {
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = (await surface(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.wheel(0, 300); // plain scrolling over the picture scrolls the page
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  } else {
    // Raw touch drags (Chromium's synthesized scroll gestures don't scroll in this headless build, on any page).
    const cdp = await context.newCDPSession(page);
    const swipe = async (x: number, y0: number, y1: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0, id: 1 }] });
      for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 12, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(500);
    };
    const viewport = page.viewportSize()!;
    // A swipe outside the picture scrolls the page.
    await page.evaluate(() => window.scrollTo(0, 0));
    await swipe(30, Math.round(viewport.height * 0.7), Math.round(viewport.height * 0.3));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    // A swipe on the picture doesn't (it's the Move tool at 100%, so nothing moves or draws either).
    await surface(page).scrollIntoViewIfNeeded();
    const box = (await surface(page).boundingBox())!;
    const before = await page.evaluate(() => window.scrollY);
    await swipe(box.x + box.width / 2, box.y + box.height * 0.8, box.y + box.height * 0.2);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await cdp.detach();
  }
  await context.close();
});

test("guardian: stylus input draws", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "pen events are sent through the desktop browser");
  const { context, page } = await member(browser);
  await open(page, kidA);
  const strokes = (await artwork(kidA))!.doc.strokes.length;
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await page.getByRole("switch", { name: /Stay inside the lines/ }).uncheck();
  const a = await at(page, 600, 650);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", clickCount: 1, pointerType: "pen", force: 0.5 });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + i * 10, y: a.y - i * 4, button: "left", pointerType: "pen", force: 0.5 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: a.x + 60, y: a.y - 24, button: "left", clickCount: 1, pointerType: "pen" });
  await cdp.detach();
  await expect.poll(async () => (await artwork(kidA))!.doc.strokes.length).toBe(strokes + 1);
  await context.close();
});

test("guardian: downloads the picture as an image", async ({ browser }) => {
  const { context, page } = await member(browser);
  await open(page, kidA);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe("coloring-demo-draft-noah-s-rainbow.png");
  const bytes = readFileSync((await d.path())!);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.length).toBeGreaterThan(10_000);
  await context.close();
});

test("others: no coloring for strangers, summary-only guardians, or signed-out requests", async ({ browser }) => {
  for (const who of [STRANGER, SUMMARY_ONLY]) {
    const context = await browser.newContext(test.info().project.use);
    const page = await context.newPage();
    await signIn(page, who);
    // The page streams, so "not found" arrives as the not-found screen (the same for a child or activity that doesn't exist).
    await page.goto(`/youth/play/${activity}?child=${kidA}`);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await expect(surface(page)).toHaveCount(0);
    await expect(page.getByText("Synthetic Ada")).toHaveCount(0);
    const put = await page.request.put(`/api/youth/coloring/${activity}`, {
      data: { child: kidA, version: activity, base_version: 0, doc: { fills: {}, strokes: [] } },
    });
    expect(put.status()).toBe(404);
    await context.close();
  }
  const anon = await browser.newContext();
  const res = await anon.request.put(`http://localhost:3100/api/youth/coloring/${activity}`, { data: { child: kidA, version: activity, base_version: 0, doc: { fills: {}, strokes: [] } } });
  expect(res.status()).toBe(401);
  await anon.close();
});

test("guardian: signing out removes unsaved coloring from the device", async ({ browser }) => {
  const { context, page } = await member(browser);
  await open(page, kidB);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Brown", exact: true }).click();
  await tapAt(page, 500, 725);
  await expect(status(page)).toHaveText(/Unable to save/, { timeout: 15_000 });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gathering.coloring.v1:")).length)).toBe(1);
  await context.setOffline(false);
  // Sign out with the real button (before the retry lands).
  await page.goto("/profile");
  await page.getByRole("button", { name: "Sign out" }).last().click();
  await page.waitForURL(/\/sign-in\?signed_out=1/);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("gathering.coloring")))).toEqual([]);
  await context.close();
});

test("accessibility: no axe violations, reduced motion, and screenshots", async ({ browser }) => {
  const context = await browser.newContext({ ...test.info().project.use, reducedMotion: "reduce" });
  const page = await context.newPage();
  await signIn(page, MEMBER);
  await open(page, kidA);
  await page.getByText(/Parts of the picture/).click();
  const results = await new AxeBuilder({ page }).include("main").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  // The zoom layer never animates (the app's reduced-motion rule caps any transition at 0.01 ms).
  const duration = await page.locator('[data-testid="coloring-surface"] > div').evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(duration).toBeLessThan(0.001);
  await noHorizontalScroll(page);
  await page.getByRole("heading", { name: "Color the picture" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/local/coloring-studio-${test.info().project.name}.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `test-results/local/coloring-studio-${test.info().project.name}-dark.png`, fullPage: false });
  await context.close();
});
