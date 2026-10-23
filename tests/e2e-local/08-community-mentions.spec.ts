import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * @mentions in the Community feed (local stack only): suggestions from the
 * keyboard and by touch, people with the same name, email addresses left
 * alone, editing and removing mentions, the notification link that reveals
 * the comment, and the "Someone mentions me" setting. Everyone here is
 * synthetic; posts are tagged [TEST]. Set MENTION_SHOTS to a folder to save
 * screenshots.
 */
const SHOTS = process.env.MENTION_SHOTS;
const stamp = Date.now();
const title = `[TEST] Mentions ${stamp}`;
let category = "";
let thread = "";
let adminId = "";

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` });
};

/** A signed-in page with this project's device (phone size and touch on "mobile"). */
async function as(browser: Browser, email: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use;
  const page = await (await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL })).newPage();
  await signIn(page, email);
  return page;
}

/** A synthetic approved member who never signs in (suggestions only). */
async function person(email: string, name: string, details: { city?: string; listed?: boolean } = {}) {
  const [{ id }] = await sql<{ id: string }>(
    `insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at,
                             confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
                             reauthentication_token, phone_change, phone_change_token)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
             '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', $2::text), now(), now(), now(), '', '', '', '', '', '', '', '')
     on conflict (email) where (is_sso_user = false) do update set updated_at = now()
     returning id`,
    [email, name],
  ).catch(async () => sql<{ id: string }>("select id from auth.users where email = $1", [email]));
  await sql("update public.profiles set membership_status = 'approved' where id = $1", [id]);
  await sql("update public.member_profile_details set city = $2, state_region = $3, directory_listed = $4 where profile_id = $1", [
    id,
    details.city ?? null,
    details.city ? "IL" : null,
    details.listed ?? true,
  ]);
  return id;
}

/** Waits for a suggestion (Enter or Tab before the list arrives types a newline or moves focus, as usual). */
const suggested = (page: Page, name: RegExp) => expect(page.getByRole("option", { name })).toBeVisible();

const card = (page: Page) => page.locator("ol[aria-label='Posts, newest first'] > li").filter({ has: page.getByRole("heading", { name: title }) });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql("delete from community.rate_events");
  const [{ id: member }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [MEMBER]);
  [{ id: adminId }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [ADMIN]);
  for (const id of [member, adminId]) {
    await sql("insert into community.guideline_acks (profile_id, version) select $1, guidelines_version from community.settings on conflict do nothing", [id]);
  }
  await person("ruth.a@example.test", "Ruth Mentionable", { city: "Springfield" });
  await person("ruth.b@example.test", "Ruth Mentionable", { city: "Shelbyville" });
  await person("ruth.hidden@example.test", "Ruth Hidden", { listed: false });
  [{ id: category }] = await sql<{ id: string }>("select id from community.categories where active order by sort_order limit 1");
  [{ id: thread }] = await sql<{ id: string }>(
    "insert into community.threads (category_id, author_id, title, body) values ($1, $2, $3, 'Synthetic post for mention checks.') returning id",
    [category, adminId, title],
  );
});

test.afterAll(async () => {
  await sql("delete from community.threads where title like '[TEST] Mentions %'");
});

test("keyboard: @ and a name suggest people; arrows and Enter mention them", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/community?category=${category}`);
  const post = card(page);
  await post.getByRole("button", { name: /^Comment/ }).click();
  const box = post.getByRole("textbox", { name: "Write a comment" });
  await box.pressSequentially("Thanks @Synth");
  const list = post.getByRole("listbox", { name: "People and groups you can mention" });
  await expect(list.getByRole("option", { name: /Synthetic Admin/ })).toBeVisible();
  // Never the author, never a pending account.
  await expect(list.getByRole("option", { name: /Synthetic Member|Synthetic Pending/ })).toHaveCount(0);
  await shot(page, "suggestions");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue(/^Thanks @Synthetic Admin $/);
  await expect(post.getByText("Mentioning:")).toBeVisible();
  await box.pressSequentially("for this! Write to office@example.org");
  await expect(list).toBeHidden();
  await shot(page, "composer-chip");
  await post.getByRole("button", { name: "Post comment" }).click();
  const comment = post.getByRole("list", { name: "Comments, newest first" }).getByRole("listitem").filter({ hasText: "for this!" });
  const link = comment.getByRole("link", { name: "@Synthetic Admin" });
  await expect(link).toHaveAttribute("href", `/directory/${adminId}`);
  await expect(comment.getByRole("link", { name: "office@example.org" })).toHaveAttribute("href", "mailto:office@example.org");
  await shot(page, "rendered");
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await noHorizontalScroll(page);
  await page.close();
});

test("people with the same name are told apart by what they share; opted-out members never appear", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/community/t/${thread}`);
  const box = page.getByRole("textbox", { name: "Write a comment" });
  await box.pressSequentially("@Ruth");
  const options = page.getByRole("listbox", { name: "People and groups you can mention" }).getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("Ruth Mentionable");
  await expect(options.filter({ hasText: "Springfield, IL" })).toHaveCount(1);
  await expect(options.filter({ hasText: "Shelbyville, IL" })).toHaveCount(1);
  await shot(page, "duplicate-names");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "People and groups you can mention" })).toBeHidden();
  await box.fill("");
  await box.pressSequentially("ruth@example.org ");
  await expect(page.getByRole("listbox", { name: "People and groups you can mention" })).toBeHidden();
  await page.close();
});

test("touch: tapping a suggestion mentions that person", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile", "phone only");
  const page = await as(browser, MEMBER);
  await page.goto(`/community/t/${thread}`);
  const box = page.getByRole("textbox", { name: "Write a comment" });
  await box.tap();
  await box.pressSequentially("Hi @Ruth M");
  const option = page.getByRole("option", { name: /Ruth Mentionable.*Shelbyville/ });
  await expect(option).toBeVisible();
  await shot(page, "suggestions-touch");
  await option.tap();
  await expect(box).toHaveValue("Hi @Ruth Mentionable ");
  await expect(box).toBeFocused();
  await noHorizontalScroll(page);
  await page.close();
});

test("editing: Backspace or the chip removes a mention; saving keeps the rest", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/community/t/${thread}`);
  const box = page.getByRole("textbox", { name: "Write a comment" });
  await box.pressSequentially("@Synth");
  await suggested(page, /Synthetic Admin/);
  await page.keyboard.press("Enter");
  await box.pressSequentially("and @Ruth");
  await page.getByRole("option", { name: /Springfield/ }).click();
  await expect(page.getByRole("button", { name: /^Remove the mention of/ })).toHaveCount(2);
  // One Backspace right after a name removes the whole mention.
  await box.press("End");
  await box.press("Backspace"); // the space after it
  await box.press("Backspace");
  await expect(box).toHaveValue("@Synthetic Admin and ");
  await expect(page.getByRole("button", { name: /^Remove the mention of/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Remove the mention of Synthetic Admin" }).click();
  await expect(box).toHaveValue("and ");
  await box.fill("Edited later: ");
  await box.pressSequentially("@Synth");
  await suggested(page, /Synthetic Admin/);
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Post comment" }).click();
  const comment = page.getByRole("list", { name: "Comments, newest first" }).getByRole("listitem").filter({ hasText: "Edited later:" });
  await expect(comment.getByRole("link", { name: "@Synthetic Admin" })).toBeVisible();
  // Edit the posted comment: the box shows plain names and the mention can be removed.
  await comment.getByRole("button", { name: /^Actions for comment/ }).click();
  await page.getByRole("menuitem", { name: "Edit comment" }).click();
  const edit = comment.getByRole("textbox", { name: "Edit your comment" });
  await expect(edit).toHaveValue("Edited later: @Synthetic Admin");
  await comment.getByRole("button", { name: "Remove the mention of Synthetic Admin" }).click();
  await edit.pressSequentially("no one");
  await comment.getByRole("button", { name: "Save" }).click();
  await expect(comment.getByRole("link", { name: "@Synthetic Admin" })).toHaveCount(0);
  await expect(comment).toContainText("Edited later: no one");
  await page.close();
});

test("the mention notice opens the post with the comment revealed", async ({ browser }) => {
  await sql("delete from community.notifications where kind = 'mention' and profile_id = $1", [adminId]);
  const author = await as(browser, MEMBER);
  await author.goto(`/community/t/${thread}`);
  const box = author.getByRole("textbox", { name: "Write a comment" });
  await box.pressSequentially("Could you look at this, @Synth");
  await suggested(author, /Synthetic Admin/);
  await author.keyboard.press("Enter");
  await author.getByRole("button", { name: "Post comment" }).click();
  const posted = author.getByRole("list", { name: "Comments, newest first" }).getByRole("listitem").filter({ hasText: "Could you look at this" });
  await expect(posted.getByRole("link", { name: "@Synthetic Admin" })).toBeVisible();
  await author.close();

  const page = await as(browser, ADMIN);
  await page.goto("/notifications");
  const item = page.getByRole("link", { name: /Synthetic Member mentioned you in a comment in Community/ }).first();
  await expect(item).toBeVisible();
  await shot(page, "notifications");
  await item.click();
  await page.waitForURL(new RegExp(`/community/t/${thread}\\?comment=[0-9a-f-]{36}$`));
  const target = page.locator(`#comment-${new URL(page.url()).searchParams.get("comment")}`);
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await expect(target).toContainText("Could you look at this, @Synthetic Admin");
  await shot(page, "revealed-comment");
  await page.close();
});

test("'Someone mentions me' is in notification settings", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto("/notifications/settings");
  const group = page.getByRole("group", { name: "Someone mentions me" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("checkbox", { name: "In the app" })).toBeChecked();
  await expect(group.getByRole("combobox", { name: "Email" }).locator("option")).toHaveText(["Off", "Right away"]);
  await group.scrollIntoViewIfNeeded();
  await shot(page, "settings");
  await page.close();
});
