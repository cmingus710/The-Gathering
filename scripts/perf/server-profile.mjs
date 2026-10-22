// Server-side profile (local stack only; see docs/navigation-performance.md):
// replays the exact RSC navigation request a tap sends (captured from the
// browser) and full document loads, one at a time, and attributes every
// Supabase call made while serving each one (from the latency gateway's log).
// Usage: node scripts/perf/server-profile.mjs <baseUrl> <label> [reps]
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.argv[2] ?? "http://localhost:3100";
if (!["127.0.0.1", "localhost"].includes(new URL(BASE).hostname)) throw new Error("Measure local builds only (seeded synthetic accounts).");
const LABEL = process.argv[3] ?? "run";
const REPS = Number(process.argv[4] ?? 8);
const GW = process.env.GATEWAY_STATS ?? "http://127.0.0.1:54331/__stats";
const gw = async () => (await (await fetch(GW)).json());

const ROUTES = [
  { from: "/home", href: "/community" },
  { from: "/home", href: "/events" },
  { from: "/home", href: "/bible" },
  { from: "/home", href: "/music" },
  { from: "/home", href: "/podcasts" },
  { from: "/community", href: "COMMUNITY_POST" },
  { from: "/events", href: "EVENT" },
  { from: "/community", href: "/home" },
];

function classify(p) {
  if (p.startsWith("/auth/v1/")) return "auth";
  if (p === "/rest/v1/profiles" || p === "/rest/v1/rpc/my_capabilities") return "membership";
  if (p === "/rest/v1/rpc/community_unread_counts" || p === "/rest/v1/church_settings") return "shell";
  if (p.startsWith("/storage/")) return "storage";
  return "data";
}
function summarize(log, t0) {
  const iv = log.map((r) => [r.t0, r.t1]).sort((a, b) => a[0] - b[0]);
  let waves = 0, end = -Infinity;
  for (const [a, b] of iv) { if (a >= end - 2) waves++; end = Math.max(end, b); }
  const by = {};
  for (const r of log) { const k = classify(r.p); by[k] = (by[k] ?? 0) + 1; }
  const firstStart = iv.length ? iv[0][0] - t0 : 0;
  const lastEnd = iv.length ? Math.max(...iv.map((x) => x[1])) - t0 : 0;
  return { n: log.length, waves, by, firstStart, lastEnd, seq: log.sort((a, b) => a.t0 - b.t0).map((r) => `${r.t0 - t0}-${r.t1 - t0} ${r.p.replace("/rest/v1", "")}`) };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto(BASE + "/sign-in");
await page.getByLabel("Email address").fill("member@example.test");
await page.getByLabel("Password", { exact: true }).fill("Gathering-dev-2026");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));

// Capture the real navigation request headers for each tap.
const captured = [];
for (const r of ROUTES) {
  await page.goto(BASE + r.from);
  await page.waitForLoadState("networkidle");
  let href = r.href;
  if (href === "COMMUNITY_POST") href = await page.locator('main a[href^="/community/t/"]').first().getAttribute("href");
  if (href === "EVENT") href = await page.locator('main a[href^="/events/"]:not([href*="calendar"])').first().getAttribute("href");
  const reqP = page.waitForRequest((q) => q.url().includes(href.split("?")[0]) && q.headers()["rsc"] === "1" && !q.headers()["next-router-prefetch"], { timeout: 15000 });
  await page.locator(`a[href="${href}"]`).first().evaluate((el) => el.click());
  const req = await reqP;
  await page.waitForLoadState("networkidle");
  captured.push({ ...r, href, url: req.url(), headers: await req.allHeaders() });
}
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
await browser.close();

const out = [];
for (const c of captured) {
  const rows = { rsc: [], doc: [] };
  for (let i = 0; i < REPS; i++) {
    for (const kind of ["rsc", "doc"]) {
      await gw();
      const headers = kind === "rsc" ? { ...c.headers, cookie } : { cookie, accept: "text/html" };
      delete headers["content-length"]; delete headers[":method"];
      const t0 = Date.now();
      const res = await fetch(kind === "rsc" ? c.url : BASE + c.href, { headers, redirect: "manual" });
      const reader = res.body.getReader();
      let ttfb = 0, bytes = 0;
      for (;;) { const { done, value } = await reader.read(); if (!ttfb) ttfb = Date.now() - t0; if (done) break; bytes += value.length; }
      const total = Date.now() - t0;
      await new Promise((r) => setTimeout(r, 150));
      rows[kind].push({ status: res.status, ttfb, total, bytes, ...summarize((await gw()).log, t0) });
    }
  }
  const agg = (k) => ({ ttfb: median(rows[k].map((r) => r.ttfb)), total: median(rows[k].map((r) => r.total)), bytes: median(rows[k].map((r) => r.bytes)), calls: median(rows[k].map((r) => r.n)), waves: median(rows[k].map((r) => r.waves)), by: rows[k][rows[k].length - 1].by, status: rows[k][0].status, seq: rows[k][rows[k].length - 1].seq });
  const row = { route: `${c.from} → ${c.href.replace(/[0-9a-f-]{36}/, ":id")}`, rsc: agg("rsc"), doc: agg("doc") };
  out.push(row);
  console.error(`${LABEL} ${row.route}: RSC ${row.rsc.status} ttfb ${row.rsc.ttfb} total ${row.rsc.total}ms ${row.rsc.bytes}B calls ${row.rsc.calls} waves ${row.rsc.waves} ${JSON.stringify(row.rsc.by)} | DOC ${row.doc.status} total ${row.doc.total}ms ${row.doc.bytes}B calls ${row.doc.calls} waves ${row.doc.waves}`);
}
fs.writeFileSync(`${process.env.OUT_DIR ?? "."}/server-${LABEL}.json`, JSON.stringify(out, null, 1));
