import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Group @mentions in Community and people and group @mentions in Prayer
 * (local stack only): the Members and Groups sections, what choosing a group
 * will do, the group's "Who can notify this group" setting, the prayer
 * composer keeping the audience in view and explaining mentions an audience
 * change would break, comment links that reveal the comment, the mention
 * settings, and the list staying inside the viewport on a phone. Everyone
 * and every group here is synthetic and tagged [TEST]. Set MENTION_SHOTS to
 * a folder to save screenshots.
 */
const SHOTS = process.env.MENTION_SHOTS;
const stamp = Date.now();
const GROUP = `Mention Worship ${stamp % 100000}`;
// An ordinary member of the group (the seeded admin is a super administrator,
// which counts as a community moderator, so it may notify the group).
const EDITOR = "editor@example.test";
let groupId = "";
let memberId = "";
let adminId = "";
let category = "";
let thread = "";

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` });
};

async function as(browser: Browser, email: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use;
  const page = await (await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL })).newPage();
  await signIn(page, email);
  return page;
}

const list = (page: Page) => page.getByRole("listbox", { name: "People and groups you can mention" });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql("delete from community.rate_events");
  [{ id: memberId }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [MEMBER]);
  [{ id: adminId }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [ADMIN]);
  for (const id of [memberId, adminId]) {
    await sql("insert into community.guideline_acks (profile_id, version) select $1, guidelines_version from community.settings on conflict do nothing", [id]);
  }
  [{ id: groupId }] = await sql<{ id: string }>(
    "insert into community.groups (name, summary, visibility, created_by) values ($1, '[TEST] synthetic group', 'discoverable', $2) returning id",
    [GROUP, adminId],
  );
  const [{ id: editorId }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [EDITOR]);
  await sql("insert into community.guideline_acks (profile_id, version) select $1, guidelines_version from community.settings on conflict do nothing", [editorId]);
  await sql("insert into community.group_members (group_id, profile_id, role) values ($1, $2, 'leader'), ($1, $3, 'member'), ($1, $4, 'member')", [
    groupId,
    memberId,
    adminId,
    editorId,
  ]);
  [{ id: category }] = await sql<{ id: string }>("select id from community.categories where active order by sort_order limit 1");
  [{ id: thread }] = await sql<{ id: string }>(
    "insert into community.threads (category_id, author_id, title, body) values ($1, $2, $3, 'Synthetic post for group mention checks.') returning id",
    [category, adminId, `[TEST] Group mentions ${stamp}`],
  );
});

test.afterAll(async () => {
  await sql("delete from community.threads where title like '[TEST] Group mentions %'");
  await sql("delete from prayer.requests where title like '[TEST] Mentions %'");
  await sql("delete from community.groups where id = $1", [groupId]);
});

test("Community: groups are listed apart from people, and choosing one says who it notifies", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/community/t/${thread}`);
  const box = page.getByRole("textbox", { name: "Write a comment" });
  await box.pressSequentially("Thanks @Mention Wor");
  const groups = list(page).getByRole("group", { name: "Groups" });
  await expect(groups.getByRole("option", { name: new RegExp(GROUP) })).toBeVisible();
  await expect(groups.getByRole("option", { name: new RegExp(GROUP) })).toContainText("Notifies 2 people");
  await shot(page, "group-suggestions");
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue(`Thanks @${GROUP} `);
  await expect(page.getByText(`Notifies 2 people in ${GROUP} who can see this.`)).toBeVisible();
  await shot(page, "group-chip");
  await page.getByRole("button", { name: "Post comment" }).click();
  const comment = page.getByRole("list", { name: "Comments, newest first" }).getByRole("listitem").filter({ hasText: "Thanks" }).first();
  const link = comment.getByRole("link", { name: `@${GROUP} (group)` });
  await expect(link).toHaveAttribute("href", `/groups/${groupId}`);
  await shot(page, "group-rendered");
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await noHorizontalScroll(page);
  await page.close();

  const admin = await as(browser, ADMIN);
  await admin.goto("/notifications");
  const item = admin.getByRole("link", { name: new RegExp(`mentioned your group, ${GROUP}, in a comment in Community`) }).first();
  await expect(item).toBeVisible();
  await item.click();
  await admin.waitForURL(new RegExp(`/community/t/${thread}\\?comment=[0-9a-f-]{36}$`));
  await expect(admin.locator(`#comment-${new URL(admin.url()).searchParams.get("comment")}`)).toBeFocused();
  await admin.close();
});

test("a member who isn't a leader references the group without notifying, and is told so", async ({ browser }) => {
  const page = await as(browser, EDITOR);
  await page.goto(`/community/t/${thread}`);
  const box = page.getByRole("textbox", { name: "Write a comment" });
  await box.pressSequentially("See @Mention Wor");
  const option = list(page).getByRole("option", { name: new RegExp(GROUP) });
  await expect(option).toContainText("Mention without notifying");
  await option.click();
  await expect(page.getByText(`${GROUP} is mentioned without notifying anyone: only its leaders and moderators can notify the group.`)).toBeVisible();
  await shot(page, "group-reference-only");
  await page.close();
});

test("leaders choose who can notify the group", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/groups/${groupId}/manage`);
  const setting = page.getByRole("group", { name: "Who can notify this group through @mentions?" });
  await expect(setting.getByRole("radio", { name: /Leaders and moderators only/ })).toBeChecked();
  await setting.getByRole("radio", { name: /Group members/ }).check();
  await page.getByRole("button", { name: "Save mention setting" }).click();
  await expect(page.getByText("Mention setting saved.")).toBeVisible();
  await setting.scrollIntoViewIfNeeded();
  await shot(page, "group-setting");
  await page.close();
  expect((await sql<{ mention_notify: string }>("select mention_notify from community.groups where id = $1", [groupId]))[0].mention_notify).toBe("members");
});

test("Prayer: the audience stays in view, and an audience change explains mentions it would break", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/prayer/new");
  await page.getByLabel("Title").fill(`[TEST] Mentions ${stamp}`);
  const body = page.getByRole("textbox", { name: "Your request" });
  await expect(page.getByText(/Seen by church members\./)).toBeVisible();
  await body.pressSequentially("Please pray with @Synth");
  const members = list(page).getByRole("group", { name: "Members" });
  await expect(members.getByRole("option", { name: /Synthetic Admin/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await body.pressSequentially("and @Mention Wor");
  await expect(list(page).getByRole("group", { name: "Groups" }).getByRole("option", { name: new RegExp(GROUP) })).toBeVisible();
  await page.keyboard.press("Enter");
  await shot(page, "prayer-composer");
  // Confidential: mentions aren't available, explained before saving.
  await page.getByRole("radio", { name: /Prayer & care team/ }).check();
  await expect(page.getByText("Mentions aren't available on confidential requests.")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Confidential requests can't mention anyone" })).toBeVisible();
  await shot(page, "prayer-audience-problem");
  // Back to the church: fine again; share it.
  await page.getByRole("radio", { name: /Church members/ }).check();
  await expect(page.getByRole("alert").filter({ hasText: "Confidential requests" })).toHaveCount(0);
  await page.getByRole("button", { name: "Share request" }).click();
  await page.getByRole("button", { name: "Yes, share it" }).click();
  await page.waitForURL(/\/prayer\/[0-9a-f-]{36}\?saved=shared$/);
  const card = page.locator("article").first();
  await expect(card.getByRole("link", { name: "@Synthetic Admin" })).toBeVisible();
  await expect(card.getByRole("link", { name: `@${GROUP} (group)` })).toBeVisible();
  await noHorizontalScroll(page);
  await page.close();

  const admin = await as(browser, ADMIN);
  await admin.goto("/notifications");
  const item = admin.getByRole("link", { name: /You were mentioned in a prayer request/ }).first();
  await expect(item).toBeVisible();
  // Never who wrote it.
  await expect(item).not.toContainText("Synthetic Member");
  await shot(admin, "prayer-notification");
  await admin.close();
});

test("Prayer comments: a mention links to the comment and reveals it", async ({ browser }) => {
  const [{ id: request }] = await sql<{ id: string }>("select id from prayer.requests where title = $1", [`[TEST] Mentions ${stamp}`]);
  const page = await as(browser, MEMBER);
  await page.goto(`/prayer/${request}`);
  const box = page.getByRole("textbox", { name: "Share encouragement" });
  await expect(page.getByText(/Seen by church members, the people who can read this request/)).toBeVisible();
  await box.pressSequentially("Thank you @Synth");
  await expect(list(page).getByRole("option", { name: /Synthetic Admin/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.locator("article[id^='comment-']").filter({ hasText: "Thank you" }).getByRole("link", { name: "@Synthetic Admin" })).toBeVisible();
  await page.close();

  const admin = await as(browser, ADMIN);
  await admin.goto("/notifications");
  await admin.getByRole("link", { name: /You were mentioned in a comment on a prayer request/ }).first().click();
  await admin.waitForURL(new RegExp(`/prayer/${request}\\?comment=[0-9a-f-]{36}$`));
  const target = admin.locator(`#comment-${new URL(admin.url()).searchParams.get("comment")}`);
  await expect(target).toBeFocused();
  await shot(admin, "prayer-comment-revealed");
  await admin.close();
});

test("phone: the list stays inside the viewport above the keyboard and dock, and a tap chooses a group", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile", "phone only");
  const page = await as(browser, MEMBER);
  await page.goto(`/community/t/${thread}`);
  const box = page.getByRole("textbox", { name: "Write a comment" });
  await box.tap();
  await box.pressSequentially("@Mention Wor");
  const option = list(page).getByRole("option", { name: new RegExp(GROUP) });
  await expect(option).toBeVisible();
  const vp = page.viewportSize()!;
  const rect = (await list(page).boundingBox())!;
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(vp.height);
  expect(rect.x + rect.width).toBeLessThanOrEqual(vp.width);
  await shot(page, "group-suggestions-touch");
  await option.tap();
  await expect(box).toHaveValue(`@${GROUP} `);
  await noHorizontalScroll(page);
  await page.close();
});

test("settings list 'Someone mentions me' and 'My group is mentioned'", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/notifications/settings");
  for (const name of ["Someone mentions me", "My group is mentioned"]) {
    const group = page.getByRole("group", { name });
    await expect(group).toBeVisible();
    await expect(group.getByRole("combobox", { name: "Email" }).locator("option")).toHaveText(["Off", "Right away"]);
  }
  await page.getByRole("group", { name: "My group is mentioned" }).scrollIntoViewIfNeeded();
  await shot(page, "settings");
  await page.close();
});
