// Navigation-latency harness (local stack only; see docs/navigation-performance.md):
// a production build, iPhone-sized Chromium with 4x CPU throttle and an
// LTE-like network, signed in as the seeded local member. Times each tap from
// the touch to the first visible feedback and to the finished page, Back, and
// the list position after returning from a detail page.
// Usage: node scripts/perf/nav-timings.mjs <baseUrl> <label> [runs]
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.argv[2] ?? "http://localhost:3100";
if (!["127.0.0.1", "localhost"].includes(new URL(BASE).hostname)) throw new Error("Measure local builds only (seeded synthetic accounts).");
const LABEL = process.argv[3] ?? "run";
const RUNS = Number(process.argv[4] ?? 3);
const GW = process.env.GATEWAY_STATS ?? "http://127.0.0.1:54331/__stats";
const NET = { offline: false, latency: Number(process.env.NET_RTT ?? 70), downloadThroughput: (12 * 1024 * 1024) / 8, uploadThroughput: (4 * 1024 * 1024) / 8 };
const CPU = Number(process.env.CPU ?? 4);

const gw = async () => (await (await fetch(GW)).json());

function classify(p) {
  if (p.startsWith("/auth/v1/user") || p.startsWith("/auth/v1/token")) return "auth";
  if (p === "/rest/v1/profiles" || p === "/rest/v1/rpc/my_capabilities") return "membership";
  if (p === "/rest/v1/rpc/community_unread_counts" || p === "/rest/v1/church_settings") return "shell";
  if (p.startsWith("/storage/")) return "storage";
  return "data";
}
/** Length of the union of request intervals, and the sequential depth (max overlap chain). */
function summarize(log) {
  const iv = log.map((r) => [r.t0, r.t1]).sort((a, b) => a[0] - b[0]);
  let busy = 0, cur = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) { if (cur) busy += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) busy += cur[1] - cur[0];
  // Waves: requests that start after every earlier request has finished begin a new wave.
  let waves = 0, end = -Infinity;
  for (const [a, b] of iv) { if (a >= end - 2) waves++; end = Math.max(end, b); }
  const by = {};
  for (const r of log) { const k = classify(r.p); by[k] = (by[k] ?? 0) + 1; }
  return { n: log.length, busy, waves, by, paths: log.map((r) => `${r.p.replace("/rest/v1", "")}`) };
}

async function newPage(browser, state) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    storageState: state, serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NET);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const traffic = { js: 0, rsc: [], img: 0, other: 0 };
  page.on("requestfinished", async (req) => {
    const res = await req.response(); if (!res) return;
    const size = (await req.sizes().catch(() => ({ responseBodySize: 0 }))).responseBodySize;
    const url = req.url();
    if (url.includes("/_next/static/") && url.endsWith(".js")) traffic.js += size;
    else if (req.headers()["rsc"] === "1" || url.includes("_rsc=")) traffic.rsc.push({ url: url.replace(BASE, ""), prefetch: !!req.headers()["next-router-prefetch"], t: req.timing(), size });
    else if (req.resourceType() === "image") traffic.img += size;
  });
  return { ctx, page, cdp, traffic };
}

/** Taps the first visible link to href and times feedback and completion. */
async function tapAndTime(page, selector, done, jsClick = false) {
  await page.evaluate(() => {
    window.__nav = { t0: 0, feedback: 0, url: 0 };
    const main = document.querySelector("main") ?? document.body;
    const h1 = () => document.querySelector("main h1")?.textContent ?? "";
    const startH1 = h1();
    const start = location.pathname + location.search;
    const tick = () => {
      if (!window.__nav.t0) return requestAnimationFrame(tick);
      const now = performance.now();
      const m = document.querySelector("main") ?? document.body;
      if (!window.__nav.feedback && (m !== main || h1() !== startH1 || location.pathname + location.search !== start || document.querySelector("main [role=status] .animate-spin, main [data-loading], main [data-link-pending]"))) window.__nav.feedback = now - window.__nav.t0;
      if (!window.__nav.url && location.pathname + location.search !== start) window.__nav.url = now - window.__nav.t0;
      if (!window.__nav.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.addEventListener("click", () => { window.__nav.t0 = performance.now(); }, { capture: true, once: true });
  });
  await gw(); // clear the call log
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  if (jsClick) await page.locator(selector).first().evaluate((el) => el.click()); else await page.locator(selector).first().tap();
  await page.waitForFunction(`(${done})()`, null, { timeout: 30000, polling: "raf" });
  const r = await page.evaluate(() => { window.__nav.done = true; if (!window.__nav.feedback) window.__nav.feedback = performance.now() - window.__nav.t0; return { ...window.__nav, total: performance.now() - window.__nav.t0 }; });
  await page.waitForTimeout(300);
  const server = summarize((await gw()).log);
  return { feedback: Math.round(r.feedback), total: Math.round(r.total), server };
}

const heading = (text) => `() => { const h = document.querySelector('main h1'); return !!h && h.textContent.includes(${JSON.stringify(text)}) && !document.querySelector('main [role=status] .animate-spin'); }`;
const JOURNEYS = [
  { name: "Home → Community", sel: 'main a[href="/community"]', done: heading("Community") },
  { name: "Home → Events", sel: 'main a[href="/events"]', done: heading("Events") },
  { name: "Home → Bible", sel: 'main a[href="/bible"]', done: heading("Bible") },
  { name: "Home → Music", sel: 'main a[href="/music"]', done: heading("Music") },
  { name: "Home → Podcasts", sel: 'main a[href="/podcasts"]', done: heading("Podcasts") },
];


/** history.back() timed inside the page (Playwright's goBack waits for a load event an SPA never fires). */
async function backAndTime(page, done) {
  return Math.round(await page.evaluate(async (doneSrc) => {
    const done = eval(`(${doneSrc})`);
    const t0 = performance.now();
    history.back();
    await new Promise((r) => setTimeout(r, 0));
    return await new Promise((res) => { const tick = () => (done() ? res(performance.now() - t0) : requestAnimationFrame(tick)); tick(); });
  }, done));
}

async function fullLoad(page, path, done) {
  await gw();
  const t = Date.now();
  await page.goto(BASE + path, { waitUntil: "commit" });
  await page.waitForFunction(`(${done})()`, null, { timeout: 30000, polling: "raf" });
  const visible = Date.now() - t;
  await page.waitForLoadState("load");
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { ttfb: Math.round(n.responseStart - n.requestStart), domInteractive: Math.round(n.domInteractive), load: Math.round(n.loadEventEnd), fcp: Math.round(fcp?.startTime ?? 0) };
  });
  await page.waitForTimeout(1500); // let viewport prefetches settle
  return { visible, ...nav, server: summarize((await gw()).log) };
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  // Sign in once and reuse the session cookie.
  const { ctx: sctx, page: sp } = await newPage(browser);
  await sp.goto(BASE + "/sign-in");
  await sp.getByLabel("Email address").fill("member@example.test");
  await sp.getByLabel("Password", { exact: true }).fill("Gathering-dev-2026");
  await sp.getByRole("button", { name: "Sign in" }).click();
  await sp.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 });
  const state = await sctx.storageState();
  await sctx.close();

  const results = [];
  for (let run = 0; run < RUNS; run++) {
    for (const j of JOURNEYS) {
      const { ctx, page, traffic } = await newPage(browser, state);
      const home = await fullLoad(page, "/home", heading("Good"));
      const homeJs = traffic.js;
      const prefetches = traffic.rsc.filter((r) => r.prefetch).length;
      traffic.rsc.length = 0;
      const first = await tapAndTime(page, j.sel, j.done);
      const firstRsc = traffic.rsc.splice(0);
      const jsAfterFirst = traffic.js - homeJs;
      // Back to Home (history), then the same tap again.
      await gw();
      const back = { total: await backAndTime(page, `() => location.pathname === "/home" && (${heading("Good")})()`), server: null };
      await page.waitForTimeout(300);
      back.server = summarize((await gw()).log);
      await page.waitForTimeout(1500);
      traffic.rsc.length = 0;
      const repeat = await tapAndTime(page, j.sel, j.done);
      results.push({ run, journey: j.name, home, homeJs, prefetchesOnHome: prefetches, first, firstRsc: firstRsc.map((r) => ({ url: r.url, prefetch: r.prefetch, size: r.size })), jsAfterFirst, back, repeat });
      process.stderr.write(`${LABEL} run${run} ${j.name}: home ${home.visible}ms; first tap fb ${first.feedback} total ${first.total} (srv ${first.server.n} req/${first.server.waves} waves); back ${back.total}; repeat fb ${repeat.feedback} total ${repeat.total} (srv ${repeat.server.n}/${repeat.server.waves})\n`);
      await ctx.close();
    }
  }

  // Detail journeys: Community post and an event, then back (scroll position).
  const details = [];
  for (let run = 0; run < RUNS; run++) {
    for (const d of [
      { name: "Community → post → back", list: "/community", listDone: heading("Community"), item: 'main article a[href^="/community/t/"]', nth: 5, itemDone: `() => location.pathname.startsWith('/community/t/') && !!document.querySelector('main h1')` },
      { name: "Events → event → back", list: "/events", listDone: heading("Events"), item: 'main a[href^="/events/"]:not([href*="calendar"])', nth: 8, itemDone: `() => /^\\/events\\/[0-9a-f-]{36}$/.test(location.pathname) && !!document.querySelector('main h1')` },
    ]) {
      const { ctx, page } = await newPage(browser, state);
      const list = await fullLoad(page, d.list, d.listDone);
      const target = page.locator(d.item).nth(d.nth);
      await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
      const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));
      const sel = `${d.item} >> nth=${d.nth}`;
      const open = await tapAndTime(page, sel, d.itemDone, true);
      await page.waitForTimeout(800);
      await gw();
      const backMs = await backAndTime(page, `() => location.pathname === ${JSON.stringify(d.list)} && (${d.listDone})()`);
      await page.waitForTimeout(600);
      const back = { total: backMs, scrollBefore, scrollAfter: await page.evaluate(() => Math.round(window.scrollY)), server: summarize((await gw()).log) };
      details.push({ run, journey: d.name, list, open, back });
      process.stderr.write(`${LABEL} run${run} ${d.name}: list ${list.visible}ms; open fb ${open.feedback} total ${open.total} (srv ${open.server.n}/${open.server.waves}); back ${back.total}ms scroll ${scrollBefore}→${back.scrollAfter} (srv ${back.server.n})\n`);
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(`${process.env.OUT_DIR ?? "."}/results-${LABEL}.json`, JSON.stringify({ NET, CPU, latency: process.env.LATENCY_MS, results, details }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
