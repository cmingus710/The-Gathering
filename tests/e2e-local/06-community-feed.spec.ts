import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, sql } from "./helpers";

/**
 * Community feed (local stack only): original posts newest first by when
 * they were posted, comments collapsed until asked for and newest first,
 * new comments at the top with the count updated in place, drafts kept
 * across collapse, notification links that reveal an old comment, and
 * mobile layout. Every post here is synthetic and tagged [TEST].
 */
const stamp = Date.now();
let category = "";
let older = "";
let oldComment = "";

async function as(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  return page;
}
const card = (page: Page, title: string) => page.locator("ol[aria-label='Posts, newest first'] > li").filter({ has: page.getByRole("heading", { name: title }) });

test.beforeAll(async () => {
  await sql("delete from community.rate_events");
  const [{ id: member }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [MEMBER]);
  const [{ id: admin }] = await sql<{ id: string }>("select id from public.profiles where email = $1", [ADMIN]);
  for (const id of [member, admin]) {
    await sql("insert into community.guideline_acks (profile_id, version) select $1, guidelines_version from community.settings on conflict do nothing", [id]);
  }
  [{ id: category }] = await sql<{ id: string }>("select id from community.categories where active order by sort_order limit 1");
  // Two posts a minute apart; the older one has 15 comments, the oldest very early.
  const post = async (title: string, minutes: number) =>
    (
      await sql<{ id: string }>(
        "insert into community.threads (category_id, author_id, title, body, created_at, last_activity_at) values ($1, $2, $3, 'Synthetic body.', now() - make_interval(mins => $4), now() - make_interval(mins => $4)) returning id",
        [category, admin, title, minutes],
      )
    )[0].id;
  older = await post(`[TEST] Feed older ${stamp}`, 2);
  await post(`[TEST] Feed newer ${stamp}`, 1);
  for (let i = 0; i < 15; i++) {
    const [{ id }] = await sql<{ id: string }>(
      "insert into community.posts (thread_id, author_id, body, created_at) values ($1, $2, $3, now() - make_interval(secs => 100 - $4)) returning id",
      [older, admin, `[TEST] Comment ${i}`, i],
    );
    if (i === 0) oldComment = id;
  }
  await sql("update community.threads set reply_count = 15 where id = $1", [older]);
});

test("the feed lists original posts newest first, with comments closed", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/community?category=${category}`);
  const titles = await page.locator("ol[aria-label='Posts, newest first'] > li h2").allTextContents();
  expect(titles.indexOf(`[TEST] Feed newer ${stamp}`)).toBeLessThan(titles.indexOf(`[TEST] Feed older ${stamp}`));
  await expect(page.getByText("[TEST] Comment 14")).toHaveCount(0);
  await expect(card(page, `[TEST] Feed older ${stamp}`).getByRole("button", { name: "15 comments" })).toBeVisible();
  await noHorizontalScroll(page);
  await page.close();
});

test("comments open in place newest first, page older, and a new comment lands on top", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/community?category=${category}`);
  const post = card(page, `[TEST] Feed older ${stamp}`);
  await post.getByRole("button", { name: "15 comments" }).click();
  const list = post.getByRole("list", { name: "Comments, newest first" });
  await expect(list.getByRole("listitem").first()).toContainText("[TEST] Comment 14");
  await expect(list.getByRole("listitem")).toHaveCount(10);
  await post.getByRole("button", { name: "Load older comments" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(15);
  await expect(list.getByRole("listitem").last()).toContainText("[TEST] Comment 0");

  // Draft survives collapse and reopen.
  await post.getByRole("textbox", { name: "Write a comment" }).fill("[TEST] Draft kept");
  await post.getByRole("button", { name: "Hide comments" }).click();
  await post.getByRole("button", { name: /^Comment/ }).click();
  await expect(post.getByRole("textbox", { name: "Write a comment" })).toHaveValue("[TEST] Draft kept");

  await post.getByRole("textbox", { name: "Write a comment" }).fill("[TEST] Newest comment");
  await post.getByRole("button", { name: "Post comment" }).click();
  await expect(list.getByRole("listitem").first()).toContainText("[TEST] Newest comment");
  await expect(post.getByRole("button", { name: "16 comments" })).toBeVisible();

  // Commenting and reacting never move the older post above the newer one.
  await post.getByRole("button", { name: /^React to the post/ }).click();
  await post.getByRole("group", { name: /^Reactions for the post/ }).getByRole("button", { name: /^Love/ }).click();
  await page.reload();
  const titles = await page.locator("ol[aria-label='Posts, newest first'] > li h2").allTextContents();
  expect(titles.indexOf(`[TEST] Feed newer ${stamp}`)).toBeLessThan(titles.indexOf(`[TEST] Feed older ${stamp}`));
  await page.close();
});

test("a comment link reveals that comment even beyond the first page", async ({ browser }) => {
  const page = await as(browser, MEMBER);
  await page.goto(`/community/t/${older}?comment=${oldComment}`);
  const target = page.locator(`#comment-${oldComment}`);
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await page.goto(`/community/t/${older}?comment=00000000-0000-0000-0000-000000000000`);
  await expect(page.getByText("The comment you followed isn't available anymore.")).toBeVisible();
  await page.goto(`/community/t/00000000-0000-0000-0000-000000000000`);
  await expect(page.getByRole("heading", { name: "This post isn't available" })).toBeVisible();
  await page.close();
});

test("on a phone the comment box stays above the tab bar", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout only");
  const page = await as(browser, MEMBER);
  await page.goto(`/community?category=${category}`);
  const post = card(page, `[TEST] Feed newer ${stamp}`);
  await post.getByRole("button", { name: /^Comment/ }).click();
  const box = post.getByRole("textbox", { name: "Write a comment" });
  await expect(box).toBeFocused();
  const rect = await box.boundingBox();
  const dock = await page.locator("nav").last().boundingBox();
  expect(rect && dock && rect.y + rect.height <= dock.y).toBe(true);
  await noHorizontalScroll(page);
  await page.close();
});
