import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, signIn, sql } from "./helpers";

/**
 * B, D, E, I: directory privacy, community, prayer, and in-app notifications
 * between two approved seeded members (member@ and editor@example.test) and
 * the seeded administrator, all through the browser against the local stack.
 */
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "the flow runs once"));

const OTHER = "editor@example.test";

// Posting limits are real (and were hit by reruns); reset the local counters.
test.beforeAll(async () => {
  await sql("delete from community.rate_events");
});
const stamp = Date.now();

async function as(browser: Browser, email: string): Promise<Page> {
  const page = await browser.newPage();
  await signIn(page, email);
  return page;
}

async function unread(page: Page): Promise<number> {
  const res = await page.request.get("/api/community/unread");
  expect(res.headers()["cache-control"]).toMatch(/no-store/);
  const body = (await res.json()) as { notifications?: number };
  return body.notifications ?? 0;
}

test("directory: opting out hides the member from other members' search", async ({ browser }) => {
  // Start listed (an interrupted earlier run may have left the member hidden).
  await sql("update public.member_profile_details set directory_listed = true where profile_id = (select id from auth.users where email = $1)", [MEMBER]);
  const member = await as(browser, MEMBER);
  const other = await as(browser, OTHER);
  await other.goto("/directory?q=Synthetic%20Member");
  await expect(other.getByRole("link", { name: /Synthetic Member/ })).toBeVisible();

  await member.goto("/profile/privacy");
  await member.getByLabel("Show me in the member directory").uncheck();
  await member.getByRole("button", { name: "Save privacy choices" }).click();
  await expect(member.getByRole("status").or(member.getByRole("alert")).filter({ hasText: /saved/i }).first()).toBeVisible();

  await other.goto("/directory?q=Synthetic%20Member");
  await expect(other.getByRole("link", { name: /Synthetic Member/ })).toHaveCount(0);
  const [{ id }] = await sql<{ id: string }>("select id from auth.users where email = $1", [MEMBER]);
  await other.goto(`/directory/${id}`);
  await expect(other.getByRole("heading", { level: 1, name: "We couldn't find that page" })).toBeVisible();

  await member.goto("/profile/privacy");
  await member.getByLabel("Show me in the member directory").check();
  await member.getByRole("button", { name: "Save privacy choices" }).click();
  await other.goto("/directory?q=Synthetic%20Member");
  await expect(other.getByRole("link", { name: /Synthetic Member/ })).toBeVisible();
  await member.close();
  await other.close();
});

let threadUrl = "";
const threadTitle = `[TEST] Walkthrough discussion ${stamp}`;

test("community: a member posts a discussion; unsafe markup is inert", async ({ browser }) => {
  const member = await as(browser, MEMBER);
  await member.goto("/community/new");
  if (member.url().includes("/community/guidelines")) {
    await member.getByLabel("I've read these guidelines and will follow them.").check();
    await member.getByRole("button", { name: "Accept and continue" }).click();
    await member.waitForURL(/\/community\/new/);
  }
  await member.getByRole("link", { name: /General Discussion/ }).click();
  await member.getByLabel("Title").fill(threadTitle);
  await member.getByLabel("Message").fill("Synthetic body. [Looks local](</\t/evil.example/x>) <script>window.__xss=1</script> **bold**");
  await member.getByRole("button", { name: "Post discussion" }).click();
  await member.waitForURL(/\/community\/t\//);
  threadUrl = new URL(member.url()).pathname;
  await expect(member.getByRole("heading", { name: threadTitle })).toBeVisible();
  await expect(member.getByRole("link", { name: "Looks local" })).toHaveCount(0);
  expect(await member.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(member.locator("strong", { hasText: "bold" })).toBeVisible();
  await member.close();
});

test("community: a reply notifies the author in the app, and the notice opens the thread", async ({ browser }) => {
  const member = await as(browser, MEMBER);
  const before = await unread(member);
  expect(threadUrl, "thread created by the previous step").toMatch(/^\/community\/t\//);
  const other = await as(browser, OTHER);
  await other.goto(`/community/guidelines?next=${encodeURIComponent(threadUrl)}`);
  const accept = other.getByLabel("I've read these guidelines and will follow them.");
  if (await accept.count()) {
    await accept.check();
    await other.getByRole("button", { name: "Accept and continue" }).click();
    await other.waitForURL((u) => u.pathname === threadUrl);
  } else {
    await other.goto(threadUrl);
  }
  await other.getByRole("textbox", { name: "Write a comment" }).fill("[TEST] Synthetic reply");
  await other.getByRole("button", { name: "Post comment" }).click();
  await expect(other.getByText("[TEST] Synthetic reply")).toBeVisible();

  await expect.poll(() => unread(member), { timeout: 15_000 }).toBeGreaterThan(before);
  await member.goto("/notifications");
  const notice = member.getByRole("link", { name: new RegExp(threadTitle.replace(/[[\]]/g, "\\$&")) }).first();
  await expect(notice).toBeVisible();
  await notice.click();
  await member.waitForURL((u) => u.pathname.startsWith("/community/t/"));
  await member.close();
  await other.close();
});

test("community: a report reaches moderators and not ordinary members", async ({ browser }) => {
  const other = await as(browser, OTHER);
  await other.goto(threadUrl);
  await other.getByRole("button", { name: "Report this discussion" }).click();
  const dialog = other.getByRole("dialog", { name: "Report this discussion" });
  await expect(dialog.getByRole("radio").first()).toBeChecked();
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await other.goto("/admin/moderation");
  await expect(other).not.toHaveURL(/\/admin\/moderation$/);

  const admin = await as(browser, ADMIN);
  await admin.goto("/admin/moderation");
  const [report] = await sql<{ id: string }>("select id from community.reports order by created_at desc limit 1");
  await expect(admin.locator(`a[href="/admin/moderation/${report.id}"]`)).toBeVisible();
  await admin.locator(`a[href="/admin/moderation/${report.id}"]`).click();
  await admin.waitForURL(/\/admin\/moderation\/[0-9a-f-]{36}/);
  await expect(admin.getByText(threadTitle).first()).toBeVisible();
  await admin.close();
  await other.close();
});

const prayerTitle = `[TEST] Walkthrough prayer ${stamp}`;
const privateTitle = `[TEST] Private draft ${stamp}`;

test("prayer: church-wide requests are shared and supported; private drafts stay private", async ({ browser }) => {
  const member = await as(browser, MEMBER);
  await member.goto("/prayer/new");
  await member.getByLabel("Title").fill(prayerTitle);
  await member.getByLabel("Your request").fill("Synthetic request body.");
  await member.getByRole("radio", { name: /^Church members/ }).check();
  await member.getByRole("button", { name: "Share request" }).click();
  const share = member.getByRole("dialog", { name: "Share with church members?" });
  await expect(share.getByRole("button", { name: "Go back" })).toBeFocused();
  await share.getByRole("button", { name: "Yes, share it" }).click();
  await member.waitForURL(/\/prayer\/[0-9a-f-]{36}/);
  const publicUrl = new URL(member.url()).pathname;

  await member.goto("/prayer/new");
  await member.getByLabel("Title").fill(privateTitle);
  await member.getByLabel("Your request").fill("Synthetic private body.");
  await member.getByRole("radio", { name: /^Private draft/ }).check();
  await member.getByRole("button", { name: "Save private draft" }).click();
  await member.waitForURL(/\/prayer\/[0-9a-f-]{36}/);
  const privateUrl = new URL(member.url()).pathname;

  const other = await as(browser, OTHER);
  await other.goto("/prayer");
  // The link's accessible name, so a hidden copy kept briefly during a refresh doesn't count twice.
  await expect(other.getByRole("link", { name: new RegExp(prayerTitle.replace(/[[\]]/g, "\\$&")) })).toBeVisible();
  await expect(other.getByText(privateTitle)).toHaveCount(0);
  await other.goto(privateUrl);
  await expect(other.getByText(privateTitle)).toHaveCount(0);
  await expect(other.getByRole("heading", { level: 1, name: /couldn't find|not found|isn't available/i })).toBeVisible();

  await other.goto(publicUrl);
  await other.getByRole("button", { name: "I'll pray" }).click();
  await expect(other.getByRole("button", { name: "I'm praying" })).toHaveAttribute("aria-pressed", "true");
  await expect(other.getByText("1 praying")).toBeVisible();

  // The super administrator gets no special read access to a private draft.
  const admin = await as(browser, ADMIN);
  await admin.goto(privateUrl);
  await expect(admin.getByText(privateTitle)).toHaveCount(0);

  // Email/push titles for prayer are generic (lock-screen privacy).
  const rows = await sql<{ title: string }>(
    "select community.notification_email_item(n)->>'title' as title from community.notifications n where n.category = 'prayer' order by n.created_at desc limit 5",
  );
  for (const r of rows) expect(r.title ?? "").not.toContain("Walkthrough prayer");
  await admin.close();
  await member.close();
  await other.close();
});
