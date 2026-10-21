import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, MEMBER, noHorizontalScroll, signIn, signOut, sql } from "./helpers";

/**
 * Phase 12 release candidate: the welcome page, Spotify players on Music,
 * the phone shell (header and bottom dock) across member pages, and
 * "Report a problem". Local stack only; content created here is marked
 * [TEST] and removed at the end.
 */

const SHOTS = process.env.PHASE12_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("welcome page: barn photo, three icons, working links, no empty sections", async ({ page }, info) => {
  await page.goto("/");
  const hero = page.locator("main img").first();
  await expect(hero).toBeVisible();
  expect(await hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  const icons = page.locator(".welcome-icon");
  await expect(icons).toHaveCount(3);
  for (const src of ["/brand/welcome/gather-with-us.svg", "/brand/welcome/grow-in-faith.svg", "/brand/welcome/share-life.svg"]) {
    const res = await page.request.get(src);
    expect(res.status(), src).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
  }
  for (const icon of await icons.all()) {
    const box = await icon.boundingBox();
    expect(box && box.width >= 60 && box.height >= 60).toBe(true);
    expect(await icon.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)).toContain("/brand/welcome/");
  }
  for (const heading of ["Gather with us", "Grow in faith", "Share life"]) await expect(page.getByRole("heading", { name: heading })).toBeVisible();

  // Every section that renders has something in it besides its heading.
  const empty = await page.locator("main section").evaluateAll((sections) =>
    sections.filter((s) => (s.textContent ?? "").trim().length < 20 && !s.querySelector("img, iframe, .welcome-icon")).length,
  );
  expect(empty).toBe(0);
  await noHorizontalScroll(page);
  await axe(page);
  await shot(page, `welcome-${info.project.name}`);

  await page.getByRole("link", { name: /sign in/i }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await page.getByRole("link", { name: /join|register|create|sign up/i }).first().click();
  await expect(page).toHaveURL(/\/sign-up$/);
});

test("music: published playlists play on the page with save and Open in Spotify", async ({ page }, info) => {
  const tag = `[TEST] P12 ${info.project.name}`;
  await sql("delete from media.items where title like $1", [`${tag}%`]);
  await sql(
    `insert into media.items (kind, title, summary, status, publish_at, audience, spotify_id, featured)
     values ('playlist', $1, 'Synthetic playlist.', 'published', now() - interval '1 minute', 'members', '37i9dQZF1DXcBWIGoYBM5M', true),
            ('playlist', $2, 'Synthetic second playlist.', 'published', now() - interval '1 minute', 'members', '37i9dQZF1DX0XUsuxWHRQd', false),
            ('playlist', $3, 'Synthetic draft.', 'draft', null, 'members', '37i9dQZF1DWXRqgorJj26U', false)`,
    [`${tag} Sunday set`, `${tag} Weekday set`, `${tag} Draft set`],
  );
  try {
    await signIn(page, MEMBER);
    await page.goto("/music");
    for (const name of [`${tag} Sunday set`, `${tag} Weekday set`]) {
      const section = page.locator("section", { has: page.getByRole("heading", { name }) });
      await section.scrollIntoViewIfNeeded();
      const frame = section.locator("iframe");
      await expect(frame).toHaveAttribute("src", /^https:\/\/open\.spotify\.com\/embed\/playlist\/37i9dQZF1D/);
      await expect(section.getByRole("link", { name: /open in spotify/i })).toHaveAttribute("href", /^https:\/\/open\.spotify\.com\/playlist\//);
      await expect(section.getByRole("button", { name: /save/i })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: `${tag} Draft set` })).toHaveCount(0);

    // Bookmark round trip.
    const first = page.locator("section", { has: page.getByRole("heading", { name: `${tag} Sunday set` }) });
    await first.getByRole("button", { name: /^save/i }).click();
    await expect(first.getByRole("button", { name: /saved|remove/i })).toBeVisible();
    await page.goto("/saved");
    await expect(page.getByText(`${tag} Sunday set`)).toBeVisible();
    await page.goto("/music");
    await first.getByRole("button", { name: /saved|remove/i }).click();
    await expect(first.getByRole("button", { name: /^save/i })).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, `music-${info.project.name}`);
  } finally {
    await sql("delete from media.bookmarks where item_id in (select id from media.items where title like $1)", [`${tag}%`]).catch(() => undefined);
    await sql("delete from media.items where title like $1", [`${tag}%`]);
  }
});

const SHELL_PAGES = ["/home", "/events", "/community", "/messages", "/prayer", "/music", "/memory", "/profile", "/report-problem"];

test("phone shell: full church name, usable controls, dock flush to the bottom on every page", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout");
  await signIn(page, MEMBER);
  for (const width of [320, 375, 412]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of SHELL_PAGES) {
      await page.goto(path);
      const where = `${path} @ ${width}px`;
      const header = page.locator("header").first();
      const name = header.locator(".header-wordmark");
      await expect(name, where).toBeVisible();
      // Never truncated or clipped: the text fits its own box.
      expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis"), where).toBe(true);
      for (const control of [header.getByRole("link", { name: /notifications/i }), header.getByRole("link", { name: /profile|account/i })]) {
        const box = await control.first().boundingBox();
        expect(box, where).not.toBeNull();
        expect(box!.width >= 44 && box!.height >= 44, `${where} control ≥44px`).toBe(true);
        expect(box!.x + box!.width <= width + 0.5, `${where} control on screen`).toBe(true);
      }
      const nameBox = (await name.boundingBox())!;
      const bellBox = (await header.getByRole("link", { name: /notifications/i }).first().boundingBox())!;
      expect(nameBox.x + nameBox.width <= bellBox.x + 0.5, `${where} name clear of controls`).toBe(true);

      const dock = page.locator("nav.dock");
      const geo = await dock.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { bottom: r.bottom, left: r.left, right: r.right, inner: window.innerHeight, bg: getComputedStyle(el).backgroundColor, pos: getComputedStyle(el).position };
      });
      expect(geo.pos, where).toBe("fixed");
      expect(Math.abs(geo.bottom - geo.inner), `${where} dock flush (no strip below)`).toBeLessThanOrEqual(0.5);
      expect(geo.left, where).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geo.right - width), where).toBeLessThanOrEqual(0.5);
      expect(geo.bg, `${where} dock has a background`).not.toBe("rgba(0, 0, 0, 0)");

      // The end of the page (and any fixed controls) stays clear of the dock.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const clear = await page.evaluate(() => {
        const dockTop = document.querySelector("nav.dock")!.getBoundingClientRect().top;
        const main = document.querySelector("main")!;
        const items = [...main.querySelectorAll("a, button, input, textarea, select, h1, h2, p")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        });
        const last = items.at(-1);
        const fixed = [...document.querySelectorAll("body *")].filter(
          (el) => getComputedStyle(el).position === "fixed" && !el.closest("nav.dock") && !el.closest("dialog") && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 200,
        );
        return {
          lastBottom: last ? last.getBoundingClientRect().bottom : 0,
          dockTop,
          overlappingFixed: fixed.filter((el) => el.getBoundingClientRect().bottom > dockTop + 1 && el.getBoundingClientRect().top < window.innerHeight).map((el) => el.className.toString().slice(0, 60)),
        };
      });
      expect(clear.lastBottom, `${where} last content above dock`).toBeLessThanOrEqual(clear.dockTop + 0.5);
      expect(clear.overlappingFixed, `${where} fixed controls clear of dock`).toEqual([]);
      await noHorizontalScroll(page);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/home", "/music", "/community"]) {
    await page.goto(path);
    await shot(page, `shell-390${path.replace(/\//g, "-")}`);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/home");
  await shot(page, "shell-320-home");
});

test("report a problem: member sends with the page path only; super admin reviews and resolves", async ({ page }, info) => {
  const marker = `[TEST] P12 report ${info.project.name} ${Date.now()}`;
  await signIn(page, MEMBER);
  await page.goto("/music?secret=abc#x");
  if (info.project.name === "mobile") {
    await page.locator("nav.dock").getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Report a problem" }).click();
  } else {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Report a problem" }).click();
  }
  await expect(page).toHaveURL(/\/report-problem\?from=%2Fmusic$/);
  await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  await expect(page.getByText("/music", { exact: true })).toBeVisible();
  await axe(page);

  // Validation keeps what was typed.
  await page.getByLabel("What is it about?").selectOption("media");
  await page.getByLabel("What happened?").fill("short");
  await page.getByLabel("What happened?").evaluate((el: HTMLTextAreaElement) => el.removeAttribute("minlength"));
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText(/at least 10 characters/).first()).toBeVisible();

  await page.getByLabel("What happened?").fill(`${marker}: the player did not start.`);
  await page.getByLabel(/may email me/).check();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report sent")).toBeVisible();
  await shot(page, `report-sent-${info.project.name}`);

  const [row] = await sql<{ page_path: string; contact_ok: boolean; category: string }>(
    "select page_path, contact_ok, category from public.problem_reports where description like $1",
    [`${marker}%`],
  );
  expect(row).toEqual({ page_path: "/music", contact_ok: true, category: "media" });

  // Members can't open the admin list.
  await page.goto("/admin/problem-reports");
  await expect(page).toHaveURL(/\/admin\/not-authorized|\/home/);
  await signOut(page);

  await signIn(page, ADMIN);
  await page.goto("/admin/problem-reports");
  const card = page.locator("li", { hasText: marker });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: MEMBER })).toHaveAttribute("href", `mailto:${MEMBER}`);
  await expect(card.getByText("/music", { exact: true })).toBeVisible();
  await axe(page);
  await shot(page, `report-admin-${info.project.name}`);
  await card.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.locator("li", { hasText: marker })).toHaveCount(0);
  await page.goto("/admin/problem-reports?status=resolved");
  await expect(page.locator("li", { hasText: marker })).toBeVisible();
  await sql("delete from public.problem_reports where description like $1", [`${marker}%`]);
});

test("a dropdown keeps the member's choice after a validation error (care request)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "form behaviour, one project is enough");
  await signIn(page, MEMBER);
  await page.goto("/prayer/care/new");
  const kind = page.getByLabel("What kind of help?");
  const values = await kind.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  const chosen = values[2];
  await kind.selectOption(chosen);
  const summary = page.getByLabel("Describe the need in a few words");
  await summary.fill("ab");
  await summary.evaluate((el) => el.removeAttribute("minlength"));
  await page.getByRole("button", { name: "Send to the care team" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  // Before the fix the form reset put the select back on its first option.
  await expect(kind).toHaveValue(chosen);
});
