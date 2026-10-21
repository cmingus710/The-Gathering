import { expect, test } from "@playwright/test";
import { ADMIN, firstLink, latestMail, noHorizontalScroll, signIn, signOut, sql } from "./helpers";

/**
 * A. Authentication and membership, signed in through the real UI against a
 * local Supabase stack: browser → Next.js server → Supabase Auth/PostgREST →
 * database, with Auth email captured by the local Mailpit inbox.
 */
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "the flow runs once; phone layout is checked in the accessibility spec"));

const stamp = Date.now();
const email = `walk.member.${stamp}@example.test`;
const name = `[TEST] Walk Member ${stamp}`;
const password = "Walkthrough-pass-1";
const newPassword = "Walkthrough-pass-2";

test("registration sends a verification email and the link verifies the account", async ({ page }) => {
  const since = Date.now() - 1000;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/check-email/);
  const mail = await latestMail(email, /confirm/i, since);
  const link = firstLink(mail.html, "token_hash=");
  expect(link).toContain("/auth/confirm");
  expect(link).toContain("type=email");
  await page.goto(link);
  await page.waitForURL(/\/account-status/);
  await expect(page.getByRole("heading", { name: "Thanks for registering" })).toBeVisible();
  const [row] = await sql<{ membership_status: string }>("select membership_status from public.profiles p join auth.users u on u.id = p.id where u.email = $1", [email]);
  expect(row.membership_status).toBe("pending");
});

test("pending members can't open member or admin areas", async ({ page }) => {
  await signIn(page, email, password);
  for (const path of ["/home", "/directory", "/community", "/prayer", "/messages", "/memory", "/events/calendar", "/gallery"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/account-status/);
  }
  // By design anyone signed in can give and see only their own records, in
  // the public layout without member navigation.
  await page.goto("/giving");
  await expect(page.getByRole("heading", { name: "Your giving" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/account-status/);
  await signOut(page);
});

test("an administrator approves the registration; the outcome is honest about email", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/admin/members?status=pending");
  await page.getByRole("link", { name: new RegExp(name.replace(/[[\]]/g, "\\$&")) }).click();
  await page.waitForURL(/\/admin\/members\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("button", { name: `Approve ${name}`, exact: true }).click();
  // No RESEND_API_KEY locally, so the app must say no welcome email went out.
  await expect(page.getByText(/Approved\. (A welcome email has been sent|No email was sent because email delivery isn't configured)/)).toBeVisible();
  const [audit] = await sql<{ n: number }>("select count(*)::int n from public.audit_log where action ilike '%status%' and target_id = (select id::text from auth.users where email = $1)", [email]);
  expect(audit.n).toBeGreaterThan(0);
  await signOut(page);
});

test("the approved member signs in, sees member navigation, and is turned away from admin", async ({ page }) => {
  await signIn(page, email, password);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/home\?notice=not-authorized/);
  await page.goto("/admin/finance");
  await expect(page).not.toHaveURL(/\/admin\/finance/);
  await noHorizontalScroll(page);
});

test("sign-out clears the session and private pages redirect to sign-in", async ({ page }) => {
  await signIn(page, email, password);
  await page.goto("/home");
  const res = await page.request.get("/home", { maxRedirects: 0 });
  expect(res.headers()["cache-control"]).toMatch(/no-store/);
  await signOut(page);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/sign-in/);
  // Back navigation must not show the private page from a cache.
  await page.goBack().catch(() => undefined);
  await page.goto("/directory");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("password reset by email link", async ({ page }) => {
  const since = Date.now() - 1000;
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send/i }).click();
  await page.waitForURL(/\/check-email/);
  const mail = await latestMail(email, /reset/i, since);
  const link = firstLink(mail.html, "token_hash=");
  expect(link).toContain("type=recovery");
  await page.goto(link);
  await page.waitForURL(/\/reset-password/);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: /save/i }).click();
  await page.waitForURL(/\/home\?notice=password-updated/);
  await signOut(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").or(page.getByText(/incorrect|didn't match|invalid/i)).first()).toBeVisible();
  await signIn(page, email, newPassword);
  await signOut(page);
});

test("suspension takes effect on the member's next request, and reinstatement restores access", async ({ browser }) => {
  const member = await browser.newPage();
  await signIn(member, email, newPassword);
  await member.goto("/home");
  await expect(member).toHaveURL(/\/home/);

  const admin = await browser.newPage();
  await signIn(admin, ADMIN);
  const [{ id }] = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
  await admin.goto(`/admin/members/${id}`);
  await admin.getByRole("button", { name: `Suspend ${name}`, exact: true }).click();
  const confirm = admin.getByRole("button", { name: "Yes, suspend" });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(admin.getByText("Suspended. They can no longer open member areas.")).toBeVisible();

  // Same session, no sign-out: the next page load is refused.
  await member.goto("/home");
  await expect(member).toHaveURL(/\/account-status/);
  await expect(member.getByRole("heading", { name: "Your access is paused" })).toBeVisible();

  await admin.getByRole("button", { name: `Reinstate ${name}`, exact: true }).click();
  await expect(admin.getByText("Reinstated. Their member access is restored.")).toBeVisible();
  await member.goto("/home");
  await expect(member).toHaveURL(/\/home/);
  await admin.close();
  await member.close();
});

test("a role grant appears on the next request and a confirmed removal takes it away", async ({ browser }) => {
  const member = await browser.newPage();
  await signIn(member, email, newPassword);
  const admin = await browser.newPage();
  await signIn(admin, ADMIN);
  const [{ id }] = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
  await admin.goto(`/admin/members/${id}`);
  const row = admin.getByRole("listitem").filter({ hasText: "Event coordinator" }).first();
  await row.getByRole("button", { name: /^Assign/ }).click();
  await expect(admin.getByText("Role assigned.")).toBeVisible();

  await member.goto("/admin/events");
  await expect(member).toHaveURL(/\/admin\/events/);

  await admin.reload();
  await admin.getByRole("listitem").filter({ hasText: "Event coordinator" }).first().getByRole("button", { name: /^Remove/ }).click();
  const dialog = admin.getByRole("dialog", { name: /Remove Event coordinator\?/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Remove role" }).click();
  await expect(admin.getByText("Role removed.")).toBeVisible();

  await member.goto("/admin/events");
  await expect(member).not.toHaveURL(/\/admin\/events$/);
  await admin.close();
  await member.close();
});
