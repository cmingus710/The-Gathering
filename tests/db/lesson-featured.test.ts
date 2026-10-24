import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * The Sunday lessons page (20261120000100): the featured lesson is the
 * nearest visible lesson dated the church's today or later, else the most
 * recent past one; the rest are listed oldest first without the featured
 * one, across filters and pages; "today" is the church's local date. Drafts,
 * scheduled, expired, and group-only lessons stay hidden from people who
 * can't see them. media.lessons_page takes the date so each day can be
 * pinned; public.media_lessons always uses the church's today. Every lesson
 * here is synthetic.
 */
type Card = { id: string; title: string; delivered_on: string | null };
type Page = { today: string; featured: Card | null; featured_state: string | null; items: Card[]; total: number };

describeDb("Sunday lessons: featured lesson and date order", () => {
  let db: TestDb;
  let admin: string;
  let m1: string; // approved member in the group
  let m2: string; // approved member outside the group
  let pending: string;
  const ids: Record<string, string> = {};

  const page = async (viewer: string | null, today: string, filters: object = {}, limit = 60, offset = 0) =>
    (await db.raw<{ r: Page }>("select media.lessons_page($1, $2, $3, $4, $5) r", [viewer, today, JSON.stringify(filters), limit, offset]))[0].r;
  const titles = (p: Page) => p.items.map((i) => i.title);
  const lessonsRpc = async (actor: Actor, filters: object = {}) =>
    (await db.query<{ r: Page }>(actor, "select public.media_lessons($1, 60, 0) r", [JSON.stringify(filters)]))[0].r;
  const lesson = async (
    title: string,
    date: string | null,
    o: { status?: string; publish?: string | null; expires?: string | null; audience?: string; group?: string | null; sort?: number } = {},
  ) => {
    const status = o.status ?? "published";
    const [{ id }] = await db.raw<{ id: string }>(
      `insert into media.items (kind, title, delivered_on, status, publish_at, expires_at, audience, group_id, sort_order)
       values ('lesson', $1, $2, $3::media.pub_status, $4::timestamptz, $5::timestamptz, $6::media.audience, $7, $8) returning id`,
      [title, date, status, o.publish === undefined ? (status === "draft" ? null : new Date(Date.now() - 86_400_000).toISOString()) : o.publish, o.expires ?? null, o.audience ?? "members", o.group ?? null, o.sort ?? 100],
    );
    ids[title] = id;
    return id;
  };

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, approved = true) => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (approved) await db.setStatus(id, "approved");
      return id;
    };
    admin = await mk("l.admin@example.test", "Synthetic Admin");
    m1 = await mk("l.m1@example.test", "Alpha Member");
    m2 = await mk("l.m2@example.test", "Bravo Member");
    pending = await mk("l.pending@example.test", "Pending Person", false);
    await db.grantRole(admin, "super_admin");
    const [{ r: group }] = await db.query<{ r: string }>(as(admin), "select public.community_group_save($1) r", [
      JSON.stringify({ name: "Synthetic Lesson Group", summary: "s", about: "a", visibility: "discoverable", leader_id: admin }),
    ]);
    await db.raw("insert into community.group_members (group_id, profile_id) values ($1, $2)", [group, m1]);
    await db.raw("update public.church_settings set timezone = 'America/Chicago'");

    // Inserted out of date order on purpose, with the far-off lesson first
    // (as when a lesson is published weeks early).
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await lesson("Nov 29", "2026-11-29");
    await lesson("Oct 18", "2026-10-18");
    await lesson("Oct 25 second", "2026-10-25", { sort: 200 });
    await lesson("Oct 25", "2026-10-25");
    await lesson("Oct 4 public", "2026-10-04", { audience: "public" });
    await lesson("Oct 11", "2026-10-11");
    await lesson("Nov 1 draft", "2026-11-01", { status: "draft" });
    await lesson("Nov 1 group", "2026-11-01", { audience: "group", group });
    await lesson("Nov 8 scheduled", "2026-11-08", { status: "scheduled", publish: future });
    await lesson("Oct 30 expired", "2026-10-30", { expires: new Date(Date.now() - 3_600_000).toISOString() });
    await lesson("Oct 31 archived", "2026-10-31");
    await db.raw("update media.items set status = 'archived', archived_at = now() where id = $1", [ids["Oct 31 archived"]]);
  }, 120_000);

  afterAll(async () => db?.destroy());

  describe("featured lesson", () => {
    it("on October 24 features October 25, not the later November 29 lesson", async () => {
      const p = await page(m2, "2026-10-24");
      expect(p.featured?.title).toBe("Oct 25");
      expect(p.featured_state).toBe("upcoming");
      expect(p.today).toBe("2026-10-24");
    });

    it("keeps the October 25 lesson featured on its own day, labelled today", async () => {
      const p = await page(m2, "2026-10-25");
      expect(p.featured?.title).toBe("Oct 25");
      expect(p.featured_state).toBe("today");
    });

    it("on October 26 moves to the next upcoming lesson the viewer may see", async () => {
      // Skips the draft, the not-yet-published scheduled lesson, the expired
      // one, and (for someone outside the group) the group-only lesson.
      expect((await page(m2, "2026-10-26")).featured?.title).toBe("Nov 29");
      // A group member gets the group's November 1 lesson.
      const g = await page(m1, "2026-10-26");
      expect(g.featured?.title).toBe("Nov 1 group");
      expect(g.featured_state).toBe("upcoming");
    });

    it("falls back to the most recent past lesson when none is upcoming", async () => {
      const p = await page(m2, "2026-12-01");
      expect(p.featured?.title).toBe("Nov 29");
      expect(p.featured_state).toBe("latest");
      // Visitors only see public lessons: the October 4 one, as the latest.
      const v = await page(null, "2026-10-24");
      expect(v.featured?.title).toBe("Oct 4 public");
      expect(v.featured_state).toBe("latest");
      expect(v.items).toEqual([]);
    });

    it("breaks a tie on the same date by sort order, then id", async () => {
      const a = await page(m2, "2026-10-25");
      const b = await page(m2, "2026-10-25");
      expect(a.featured?.title).toBe("Oct 25");
      expect(b.featured?.id).toBe(a.featured?.id);
      expect(titles(a)).toContain("Oct 25 second");
    });

    it("features nothing when there are no lessons the viewer may see", async () => {
      const none = await page(null, "2026-10-24", { q: "no such lesson" });
      expect(none.featured).toBeNull();
      expect(none.items).toEqual([]);
      expect(none.total).toBe(0);
    });
  });

  describe("restricted, unpublished, and scheduled lessons", () => {
    it("never lists or features drafts, scheduled, expired, archived, or other groups' lessons", async () => {
      const hidden = ["Nov 1 draft", "Nov 8 scheduled", "Oct 30 expired", "Oct 31 archived"];
      for (const today of ["2026-10-24", "2026-10-25", "2026-10-26", "2026-11-01", "2026-11-08", "2026-12-01"]) {
        for (const viewer of [m1, m2, pending, null]) {
          const p = await page(viewer, today);
          const all = [p.featured?.title, ...titles(p)];
          for (const t of hidden) expect(all).not.toContain(t);
          if (viewer !== m1) expect(all).not.toContain("Nov 1 group");
          if (viewer === pending || viewer === null) expect(all.filter(Boolean)).toEqual(["Oct 4 public"]);
        }
      }
    });

    it("shows a scheduled lesson once its publish time passes, with no republishing", async () => {
      expect((await page(m2, "2026-11-02")).featured?.title).toBe("Nov 29");
      await db.raw("update media.items set publish_at = now() - interval '1 minute' where id = $1", [ids["Nov 8 scheduled"]]);
      expect((await page(m2, "2026-11-02")).featured?.title).toBe("Nov 8 scheduled");
      await db.raw("update media.items set publish_at = now() + interval '7 days' where id = $1", [ids["Nov 8 scheduled"]]);
    });
  });

  describe("the list below", () => {
    it("lists the rest oldest first without the featured lesson", async () => {
      const p = await page(m2, "2026-10-24");
      expect(titles(p)).toEqual(["Oct 4 public", "Oct 11", "Oct 18", "Oct 25 second", "Nov 29"]);
      expect(p.total).toBe(5);
      const g = await page(m1, "2026-10-26");
      expect(titles(g)).toEqual(["Oct 4 public", "Oct 11", "Oct 18", "Oct 25", "Oct 25 second", "Nov 29"]);
    });

    it("pages through the same order with no duplicates or gaps", async () => {
      const full = await page(m1, "2026-10-24");
      const seen: string[] = [];
      for (let offset = 0; offset < full.total; offset += 2) {
        const p = await page(m1, "2026-10-24", {}, 2, offset);
        expect(p.total).toBe(full.total);
        expect(p.featured?.id).toBe(full.featured?.id);
        seen.push(...titles(p));
      }
      expect(seen).toEqual(titles(full));
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).not.toContain(full.featured?.title);
    });

    it("keeps date order for search and filters, and includes every match", async () => {
      // Filtered: nothing is featured, so the October 25 lesson is listed too.
      const q = await page(m2, "2026-10-24", { q: "Oct 2" });
      expect(q.featured).toBeNull();
      expect(titles(q)).toEqual(["Oct 25", "Oct 25 second"]);
      const range = await page(m2, "2026-10-24", { from: "2026-10-11", to: "2026-11-30" });
      expect(titles(range)).toEqual(["Oct 11", "Oct 18", "Oct 25", "Oct 25 second", "Nov 29"]);
      const paged = [...titles(await page(m2, "2026-10-24", { from: "2026-10-11" }, 3, 0)), ...titles(await page(m2, "2026-10-24", { from: "2026-10-11" }, 3, 3))];
      expect(paged).toEqual(titles(range));
      // Empty filter values don't count as filtering.
      expect((await page(m2, "2026-10-24", { q: "", series_id: "" })).featured?.title).toBe("Oct 25");
    });

    it("puts undated lessons last and never features them", async () => {
      // The schema requires a lesson date; drop that rule in this throwaway
      // database to check the page still copes with one.
      await db.raw("alter table media.items drop constraint items_lesson");
      try {
        await lesson("Undated", null);
        expect(titles(await page(m2, "2026-10-24")).at(-1)).toBe("Undated");
        const after = await page(m2, "2027-06-01");
        expect(after.featured?.title).toBe("Nov 29");
        expect(after.featured_state).toBe("latest");
        expect(titles(after).at(-1)).toBe("Undated");
      } finally {
        await db.raw("delete from media.items where id = $1", [ids.Undated]);
        await db.raw("alter table media.items add constraint items_lesson check (kind <> 'lesson' or delivered_on is not null)");
      }
    });
  });

  describe("church time zone", () => {
    it("takes the date from the church's time zone at the boundary", async () => {
      const at = async (ts: string) => (await db.raw<{ d: string }>("select media.church_date_at($1)::text d", [ts]))[0].d;
      // America/Chicago is UTC-5 in October: 11:59 pm on the 24th is still the 24th.
      expect(await at("2026-10-25T04:59:59Z")).toBe("2026-10-24");
      expect(await at("2026-10-25T05:00:00Z")).toBe("2026-10-25");
      // The day the clocks change (November 1): midnight is UTC-6 the next day.
      expect(await at("2026-11-02T05:59:59Z")).toBe("2026-11-01");
      expect(await at("2026-11-02T06:00:00Z")).toBe("2026-11-02");
      await db.raw("update public.church_settings set timezone = 'Pacific/Auckland'");
      try {
        expect(await at("2026-10-24T11:00:00Z")).toBe("2026-10-25");
      } finally {
        await db.raw("update public.church_settings set timezone = 'America/Chicago'");
      }
    });

    it("uses the church's today on every call, so the choice moves on by itself", async () => {
      // Two zones 25 hours apart are always on different dates. A lesson on
      // each zone's today: changing only the setting changes the featured
      // lesson, without touching any lesson. (Sort order 0 wins any tie with
      // the fixtures above.)
      const zones = ["Pacific/Pago_Pago", "Pacific/Kiritimati"];
      const today: string[] = [];
      for (const z of zones) {
        await db.raw("update public.church_settings set timezone = $1", [z]);
        today.push((await db.raw<{ d: string }>("select media.church_today()::text d"))[0].d);
      }
      expect(today[0] < today[1]).toBe(true);
      await lesson("West today", today[0], { sort: 0 });
      await lesson("East today", today[1], { sort: 0 });
      try {
        await db.raw("update public.church_settings set timezone = $1", [zones[0]]);
        const west = await lessonsRpc(as(m2));
        expect(west.today).toBe(today[0]);
        expect(west.featured?.title).toBe("West today");
        expect(west.featured_state).toBe("today");
        await db.raw("update public.church_settings set timezone = $1", [zones[1]]);
        const east = await lessonsRpc(as(m2));
        expect(east.today).toBe(today[1]);
        expect(east.featured?.title).toBe("East today");
        expect(east.featured_state).toBe("today");
        expect(titles(east)).toContain("West today");
      } finally {
        await db.raw("delete from media.items where id = any($1)", [[ids["West today"], ids["East today"]]]);
        await db.raw("update public.church_settings set timezone = 'America/Chicago'");
      }
    });
  });

  describe("the public entry point", () => {
    it("applies the caller's own access and can't be pointed at another viewer or date", async () => {
      const v = await lessonsRpc(anon);
      for (const c of [v.featured, ...v.items]) if (c) expect(c.title).toBe("Oct 4 public");
      const g = await lessonsRpc(as(m1));
      expect([g.featured?.title, ...titles(g)]).toContain("Nov 1 group");
      const o = await lessonsRpc(as(m2));
      expect([o.featured?.title, ...titles(o)]).not.toContain("Nov 1 group");
      await expect(db.query(anon, "select media.lessons_page(null, '2026-10-24', '{}', 20, 0)")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(m2), "select media.lessons_page($1, '2026-10-24', '{}', 20, 0)", [m1])).rejects.toThrow(/permission denied/);
    });
  });

  // 20261121000100: the home page card uses the same choice.
  describe("home page lesson card", () => {
    type Home = { lesson: Card | null; lesson_state: string | null };
    const featured = async (viewer: string | null, today: string) =>
      (await db.raw<{ o_id: string | null; o_state: string | null }>("select o_id, o_state from media.featured_lesson($1, $2)", [viewer, today]))[0];
    const home = async (actor: Actor) => (await db.query<{ r: Home }>(actor, "select public.media_home() r"))[0].r;

    it("picks the same lesson as the lessons page for every viewer and date", async () => {
      for (const today of ["2026-10-24", "2026-10-25", "2026-10-26", "2026-11-02", "2026-12-01"]) {
        for (const viewer of [m1, m2, pending, null]) {
          const p = await page(viewer, today);
          const f = await featured(viewer, today);
          expect(f.o_id).toBe(p.featured?.id ?? null);
          expect(f.o_state).toBe(p.featured_state);
        }
      }
    });

    it("features today's lesson on the home page, labelled today, using the church's date", async () => {
      const [{ d: today }] = await db.raw<{ d: string }>("select media.church_today()::text d");
      await lesson("Home today", today, { sort: 0 });
      try {
        const h = await home(as(m2));
        expect(h.lesson?.title).toBe("Home today");
        expect(h.lesson_state).toBe("today");
      } finally {
        await db.raw("delete from media.items where id = $1", [ids["Home today"]]);
      }
      // Without it, the home card matches the shared choice for the church's today.
      const f = await featured(m2, today);
      const h = await home(as(m2));
      expect(h.lesson?.id ?? null).toBe(f.o_id);
      expect(h.lesson_state).toBe(f.o_state);
    });

    it("never shows a lesson the viewer can't see, and keeps the rule internal", async () => {
      // media_home needs a signed-in person (anon can't call it, as before);
      // someone not yet approved sees only public lessons.
      await expect(db.query(anon, "select public.media_home()")).rejects.toThrow(/permission denied/);
      const v = await home(as(pending));
      expect(v.lesson?.title).toBe("Oct 4 public");
      expect(v.lesson_state).toBe("latest");
      await expect(db.query(anon, "select * from media.featured_lesson(null, '2026-10-24')")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(m2), "select * from media.featured_lesson($1, '2026-10-24')", [m1])).rejects.toThrow(/permission denied/);
    });
  });
});
