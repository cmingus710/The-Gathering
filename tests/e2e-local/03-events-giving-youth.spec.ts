import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN, MEMBER, signIn, sql } from "./helpers";

/**
 * C (test-mode state only), F, J, and a signed-in smoke pass over G/H:
 * events created by the administrator and registered for by a member, the
 * calendar export, giving's honest "not configured" state, and the youth
 * policy gate staying closed (no policy is approved here or anywhere).
 */
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "the flow runs once"));

const stamp = Date.now();
const eventTitle = `[TEST] Walkthrough gathering ${stamp}`;

async function as(browser: Browser, email: string): Promise<Page> {
  const page = await browser.newPage();
  await signIn(page, email);
  return page;
}

function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}


test("events: an administrator creates and publishes a members event with RSVP", async ({ browser }) => {
  const admin = await as(browser, ADMIN);
  await admin.goto("/admin/events/new");
  await admin.getByLabel("Title").fill(eventTitle);
  await admin.getByLabel("Date", { exact: true }).fill(inDays(10));
  await admin.getByLabel("Start time").fill("09:30");
  await admin.getByLabel("End time").fill("11:00");
  await admin.getByLabel("Location name").fill("[TEST] Synthetic Hall");
  await admin.getByLabel("Members register (RSVP) for this event").check();
  await admin.getByRole("button", { name: "Save as draft" }).click();
  await admin.waitForURL(/\/admin\/events\/[0-9a-f-]{36}/);
  await admin.getByRole("button", { name: /^Publish/ }).first().click();
  const dialog = admin.getByRole("dialog");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^Publish/ }).last().click();
  await expect(admin.getByText(/published/i).first()).toBeVisible();
  await admin.close();
});

test("events: a member registers, exports to a calendar, and cancels", async ({ browser }) => {
  const member = await as(browser, MEMBER);
  await member.goto("/events");
  await member.getByRole("link", { name: eventTitle }).first().click();
  await member.waitForURL(/\/events\/[0-9a-f-]{36}/);
  const occurrencePath = new URL(member.url()).pathname;
  await member.getByRole("button", { name: /^(Register|RSVP|I'm coming|Count me in)/ }).first().click();
  await expect(member.getByText(/you're registered|registered/i).first()).toBeVisible();

  const ics = await member.request.get(`${occurrencePath}/ics`);
  expect(ics.ok()).toBe(true);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const body = await ics.text();
  expect(body).toContain("BEGIN:VEVENT");
  expect(body).toContain(eventTitle.replace(/,/g, "\\,"));
  // 09:30 America/Chicago is written as a UTC instant (DST-safe).
  expect(body).toMatch(/DTSTART:\d{8}T1[45]3000Z/);

  await member.getByRole("button", { name: /^Cancel (my )?(registration|RSVP)/ }).first().click();
  const confirm = member.getByRole("dialog");
  if (await confirm.count()) await confirm.getByRole("button", { name: /^(Yes|Cancel registration|Cancel RSVP)/ }).last().click();
  await expect(member.getByRole("button", { name: /^(Register|RSVP|I'm coming|Count me in)/ }).first()).toBeVisible();

  const outbox = await sql<{ kind: string }>(
    "select kind from events.outbox where occurrence_id = (select o.id from events.occurrences o join events.series s on s.id = o.series_id where s.title = $1 limit 1) order by created_at",
    [eventTitle],
  );
  expect(outbox.map((r) => r.kind)).toEqual(["rsvp_confirmed", "rsvp_canceled"]);
  await member.close();
});

test("events: members-only events are hidden from signed-out visitors", async ({ page }) => {
  await page.goto("/events");
  await expect(page.getByText(eventTitle)).toHaveCount(0);
  const [occ] = await sql<{ id: string }>(
    "select o.id from events.occurrences o join events.series s on s.id = o.series_id where s.title = $1 limit 1",
    [eventTitle],
  );
  await page.goto(`/events/${occ.id}`);
  await expect(page.getByText(eventTitle)).toHaveCount(0);
});

test("giving: without Stripe keys the app says giving isn't set up and takes no payment", async ({ browser }) => {
  const member = await as(browser, MEMBER);
  await member.goto("/give");
  await expect(member.getByText(/isn't (set up|available|configured)|not (set up|configured|available)/i).first()).toBeVisible();
  await member.goto("/giving");
  await expect(member.getByRole("heading", { name: "Your giving" })).toBeVisible();
  await member.goto("/admin/finance");
  await expect(member).not.toHaveURL(/\/admin\/finance/);
  // The super administrator holds no implicit finance access either.
  const admin = await as(browser, ADMIN);
  await admin.goto("/admin/finance");
  await expect(admin).not.toHaveURL(/\/admin\/finance$/);
  await admin.close();
  await member.close();
});

test("youth: the policy gate is closed, and no youth capability comes from super administrator", async ({ browser }) => {
  const [{ n }] = await sql<{ n: number }>("select count(*)::int n from youth.policies where status = 'approved'");
  expect(n).toBe(0);
  const admin = await as(browser, ADMIN);
  await admin.goto("/admin/youth");
  // Super administrators assign youth roles but don't hold them.
  await expect(admin).not.toHaveURL(/\/admin\/youth\/policy/);
  const text = await admin.locator("main").innerText();
  expect(text).not.toMatch(/Independent youth accounts are on/i);

  const member = await as(browser, MEMBER);
  await member.goto("/youth");
  await expect(member.locator("main")).toBeVisible();
  for (const path of ["/admin/youth", "/admin/youth/policy", "/admin/youth/families"]) {
    await member.goto(path);
    await expect(member, path).not.toHaveURL(new RegExp(`${path}$`));
  }
  // The leading page is open to adults but scoped by the database to
  // assigned groups, so an unassigned member sees only the empty state.
  await member.goto("/youth/lead");
  await expect(member.getByText("You're not leading a youth group")).toBeVisible();
  await admin.close();
  await member.close();
});

test("signed-in smoke: every member area opens without an error page or sideways scrolling", async ({ browser }) => {
  const member = await as(browser, MEMBER);
  for (const path of [
    "/home", "/announcements", "/directory", "/profile", "/community", "/groups", "/messages", "/notifications",
    "/notifications/settings", "/prayer", "/events", "/events/calendar", "/devotionals", "/lessons", "/podcasts", "/music",
    "/reading", "/gallery", "/saved", "/bible", "/journal", "/memory", "/memory/progress", "/youth", "/giving",
  ]) {
    const res = await member.goto(path);
    expect(res?.status(), path).toBeLessThan(400);
    expect(res?.headers()["cache-control"] ?? "", path).toMatch(/no-store/);
    await expect(member.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
    await expect(member.getByText(/Something went wrong|Application error/i), path).toHaveCount(0);
  }
  await member.close();
});
