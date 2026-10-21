import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** Local stack only: refuse to run against anything that isn't loopback. */
export const API_URL = process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const MAILPIT_URL = process.env.LOCAL_MAILPIT_URL ?? "http://127.0.0.1:54324";
export const DB_URL = process.env.LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
for (const url of [API_URL, MAILPIT_URL, DB_URL]) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Local walkthrough refuses non-local target ${host}`);
}

export const SEED_PASSWORD = "Gathering-dev-2026";
export const ADMIN = "admin@example.test";
export const MEMBER = "member@example.test";

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

export async function signIn(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

export async function signOut(page: Page) {
  // POST through the real form; sign-out lives in the shell on every layout.
  const res = await page.request.post("/auth/sign-out", { headers: { origin: new URL(page.url()).origin } , maxRedirects: 0 });
  expect([303, 302]).toContain(res.status());
  expect(res.headers()["clear-site-data"]).toBe('"cache"');
  await page.context().clearCookies();
}

type MailSummary = { ID: string; To: { Address: string }[]; Subject: string; Created: string };

/** Latest message to `to` whose subject matches, waiting for it to arrive. */
export async function latestMail(to: string, subject: RegExp, after = 0): Promise<{ subject: string; html: string; text: string }> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`)).json()) as { messages: MailSummary[] };
    const hit = list.messages.find((m) => m.To.some((t) => t.Address === to) && subject.test(m.Subject) && Date.parse(m.Created) >= after);
    if (hit) {
      const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)).json()) as { HTML: string; Text: string; Subject: string };
      return { subject: full.Subject, html: full.HTML, text: full.Text };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} matching ${subject}`);
}

export function firstLink(html: string, contains: string): string {
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const link = links.find((l) => l.includes(contains));
  if (!link) throw new Error(`No link containing ${contains}`);
  return link;
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(1);
}
