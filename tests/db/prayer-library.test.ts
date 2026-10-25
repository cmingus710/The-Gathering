import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * The Prayer Library (20261115000100) against a real database: member
 * contributions (draft, publish, edit, archive), discovery and reading by
 * other members, search and combined filters with keyset paging, draft and
 * hidden-content privacy (lists and direct reads), private bookmarks,
 * reports, moderator hide/restore/archive with audit records, category
 * management, and that pending, suspended, and youth accounts stay out.
 * Prayer requests are untouched. Every person and prayer here is synthetic.
 */
type Json = Record<string, unknown>;
type Card = Json & { id: string; title: string; categories: Array<{ id: string; kind: string; name: string }> };
type Page = { items: Card[]; has_more: boolean };

describeDb("prayer library", () => {
  let db: TestDb;
  let admin: string; // super administrator (settings.manage), no prayer.moderate
  let mod: string; // prayer moderator
  let alice: string; // contributor
  let bob: string; // another member
  let carol: string; // another member
  let pending: string;
  let suspended: string;
  let kid: string; // youth account
  let cats: Record<string, string>; // "<kind>:<name>" → id
  let general: string; // the General prayers collection (20261124000100)

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const fails = async (actor: Actor, fn: string, args: unknown[], message?: RegExp) => {
    const p = rpc(actor, fn, args);
    if (message) await expect(p).rejects.toThrow(message);
    else await expect(p).rejects.toThrow();
  };
  const save = (
    who: string,
    opts: {
      id?: string | null;
      title?: string;
      body?: string;
      origin?: string;
      source?: string | null;
      url?: string | null;
      refs?: string[];
      categories?: string[];
      publish?: boolean;
      key?: string | null;
      collection?: string | null;
    } = {},
  ) =>
    rpc<string>(as(who), "prayer_library_save", [
      opts.id ?? null,
      opts.title ?? "A synthetic prayer",
      opts.body ?? "Synthetic words of prayer.",
      opts.origin ?? "original",
      opts.source ?? null,
      opts.url ?? null,
      opts.refs ?? [],
      opts.categories ?? [],
      opts.publish ?? true,
      opts.key ?? null,
      opts.collection === undefined ? general : opts.collection,
    ]);
  const list = (
    who: string,
    opts: { view?: string; q?: string | null; topic?: string | null; purpose?: string | null; use?: string | null; before?: string | null; beforeId?: string | null; limit?: number } = {},
  ) =>
    rpc<Page>(as(who), "prayer_library_list", [
      opts.view ?? "library",
      opts.q ?? null,
      opts.topic ?? null,
      opts.purpose ?? null,
      opts.use ?? null,
      opts.before ?? null,
      opts.beforeId ?? null,
      opts.limit ?? 50,
    ]);
  const ids = async (who: string, opts: Parameters<typeof list>[1] = {}) => (await list(who, opts)).items.map((c) => c.id);
  const read = (who: string, id: string) => rpc<Json>(as(who), "prayer_library_prayer", [id]);
  const readable = async (who: string, id: string) => {
    try {
      await read(who, id);
      return true;
    } catch {
      return false;
    }
  };

  beforeAll(async () => {
    db = await TestDb.create();
    const mk = async (email: string, name: string, status: "approved" | "pending" | "suspended" = "approved") => {
      const id = await db.createAuthUser(email, { fullName: name });
      if (status !== "pending") await db.setStatus(id, "approved");
      if (status === "suspended") await db.setStatus(id, "suspended");
      return id;
    };
    admin = await mk("l.admin@example.test", "Synthetic Admin");
    mod = await mk("l.mod@example.test", "Synthetic Moderator");
    alice = await mk("l.alice@example.test", "Alice Contributor");
    bob = await mk("l.bob@example.test", "Bob Reader");
    carol = await mk("l.carol@example.test", "Carol Reader");
    pending = await mk("l.pending@example.test", "Pending Person", "pending");
    suspended = await mk("l.suspended@example.test", "Suspended Person", "suspended");
    kid = await mk("l.kid@example.test", "Kit Young");
    await db.raw("select set_config('youth.context', 'on', false)");
    await db.raw("update public.profiles set account_kind = 'youth' where id = $1", [kid]);
    await db.raw("select set_config('youth.context', '', false)");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(mod, "prayer_moderator");
    const meta = await rpc<{ categories: Array<{ id: string; kind: string; name: string }>; collections: Array<{ id: string; is_general: boolean }> }>(as(bob), "prayer_library_meta");
    cats = Object.fromEntries(meta.categories.map((c) => [`${c.kind}:${c.name}`, c.id]));
    general = meta.collections.find((c) => c.is_general)!.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db.raw("delete from community.rate_events where profile_id is not null");
  });

  it("starts with sensible categories and no prayers", async () => {
    expect(Object.keys(cats)).toEqual(expect.arrayContaining(["purpose:Gratitude", "purpose:Comfort", "purpose:Guidance", "purpose:Confession", "purpose:Intercession", "purpose:Praise", "use:Personal prayer", "use:Family prayer", "use:Meals", "use:Small groups", "use:Worship services", "use:Opening a gathering", "use:Closing a gathering"]));
    expect(Object.keys(cats).filter((k) => k.startsWith("topic:")).length).toBeGreaterThan(5);
    expect(await db.raw("select 1 from prayer.library_prayers")).toEqual([]);
  });

  it("keeps signed-out, pending, suspended, and youth accounts out entirely", async () => {
    const id = await save(alice, { title: "Visible to adults only" });
    for (const actor of [as(pending), as(suspended), as(kid)]) {
      await fails(actor, "prayer_library_list", ["library", null, null, null, null, null, null, 20], /approved members/);
      await fails(actor, "prayer_library_prayer", [id], /approved members/);
      await fails(actor, "prayer_library_save", [null, "Youth try", "Body", "original", null, null, [], [], true, null], /approved members/);
      await fails(actor, "prayer_library_bookmark", [id, true], /approved members/);
    }
    await fails(anon, "prayer_library_list", ["library", null, null, null, null, null, null, 20], /permission denied/);
    await rpc(as(alice), "prayer_library_status", [id, "archived"]);
  });

  describe("contributing", () => {
    it("lets an approved member draft, preview privately, publish, edit, and archive their own prayer", async () => {
      const id = await save(alice, {
        title: "Morning offering",
        body: "Lord, **this day** is yours. [Read more](https://example.org/offering)",
        publish: false,
        categories: [cats["topic:Faith and growth"], cats["purpose:Praise"], cats["use:Personal prayer"]],
        refs: ["Psalm 5:3", "psalm 5:3", "Lamentations 3:22–23"],
      });
      // A draft: the contributor sees it, nobody else does (list or link).
      expect(await ids(alice, { view: "mine" })).toContain(id);
      expect(await ids(alice)).not.toContain(id);
      expect(await ids(bob)).not.toContain(id);
      expect(await readable(bob, id)).toBe(false);
      const draft = await read(alice, id);
      expect(draft).toMatchObject({ status: "draft", mine: true, can_edit: true, can_save: false, can_report: false, published_at: null });
      expect(draft.scripture_refs).toEqual(["Psalm 5:3", "Lamentations 3:22–23"]);

      // Publish: everyone (adult, approved) can discover and read it.
      await save(alice, { id, title: "Morning offering", body: "Lord, **this day** is yours.", publish: true, categories: [cats["topic:Faith and growth"], cats["purpose:Praise"]] });
      const published = await read(bob, id);
      expect(published).toMatchObject({ status: "published", mine: false, contributor: "Alice Contributor", origin: "original", can_save: true, can_report: true, can_edit: false });
      expect(await ids(bob)).toContain(id);
      const firstPublished = published.published_at;

      // Edit: same publication date, marked edited, categories replaced.
      await save(alice, { id, title: "Morning offering (revised)", body: "Lord, this day is yours.", categories: [cats["purpose:Gratitude"]] });
      const edited = await read(bob, id);
      expect(edited.title).toBe("Morning offering (revised)");
      expect(edited.published_at).toBe(firstPublished);
      expect(edited.edited_at).not.toBeNull();
      expect((edited.categories as Card["categories"]).map((c) => c.name)).toEqual(["Gratitude"]);

      // Others can't edit or change its status.
      await fails(as(bob), "prayer_library_save", [id, "Hijack", "Hijacked", "original", null, null, [], [], true, null], /wasn't found/);
      await fails(as(bob), "prayer_library_status", [id, "archived"], /wasn't found/);

      // Archive: gone from discovery and links for others; still the contributor's.
      await rpc(as(alice), "prayer_library_status", [id, "archived"]);
      expect(await ids(bob)).not.toContain(id);
      expect(await readable(bob, id)).toBe(false);
      expect(await read(alice, id)).toMatchObject({ status: "archived", can_edit: true });
      await fails(as(alice), "prayer_library_save", [id, "Edit archived", "Body", "original", null, null, [], [], true, null], /Restore this prayer/);
      // Restoring republishes it with its original date.
      await rpc(as(alice), "prayer_library_status", [id, "published"]);
      expect((await read(bob, id)).published_at).toBe(firstPublished);
      await rpc(as(alice), "prayer_library_status", [id, "archived"]);
    });

    it("records the original source separately from the contributor", async () => {
      const id = await save(alice, { title: "Prayer of Saint Francis", origin: "shared", source: "Traditional, attributed to Francis of Assisi", url: "https://example.org/francis" });
      const p = await read(bob, id);
      expect(p).toMatchObject({ contributor: "Alice Contributor", origin: "shared", source_name: "Traditional, attributed to Francis of Assisi", source_url: "https://example.org/francis" });
      await rpc(as(alice), "prayer_library_status", [id, "archived"]);
    });

    it("validates text, sources, Scripture, categories, mentions, and repeats", async () => {
      await fails(as(alice), "prayer_library_save", [null, "x", "Body", "original", null, null, [], [], true, null], /title is too short/);
      await fails(as(alice), "prayer_library_save", [null, "Title ok", " ", "original", null, null, [], [], true, null], /prayer is too short/);
      await fails(as(alice), "prayer_library_save", [null, "Title ok", "Body", "borrowed", null, null, [], [], true, null], /your own or shared/);
      await fails(as(alice), "prayer_library_save", [null, "Title ok", "Body", "shared", "Source", "javascript:alert(1)", [], [], true, null], /https/);
      await fails(as(alice), "prayer_library_save", [null, "Title ok", `Hi @[Bob](mention:${bob})`, "original", null, null, [], [], true, null], /Mentions aren't used/);
      await fails(as(alice), "prayer_library_save", [null, "Title ok", "Body", "original", null, null, [], [randomUUID()], true, null], /no longer available/);
      await fails(as(alice), "prayer_library_save", [null, "Title ok", "Body", "original", null, null, Array.from({ length: 21 }, (_, i) => `Psalm ${i + 1}`), [], true, null], /up to 20/);
      const topics = Object.entries(cats).filter(([k]) => k.startsWith("topic:")).map(([, v]) => v);
      await fails(as(alice), "prayer_library_save", [null, "Title ok", "Body", "original", null, null, [], topics.slice(0, 9), true, null], /up to 8 topics/);
      // A retried submit with the same key creates one prayer.
      const key = randomUUID();
      const a = await save(alice, { title: "Retry-safe prayer", key });
      const b = await save(alice, { title: "Retry-safe prayer", key });
      expect(a).toBe(b);
      await rpc(as(alice), "prayer_library_status", [a, "archived"]);
    });

    it("lets a member whose posting is paused keep drafts but not publish", async () => {
      await db.raw("insert into community.restrictions (profile_id, scope, reason, created_by) values ($1, 'posting', 'Synthetic', $2)", [carol, admin]);
      const draft = await save(carol, { title: "Paused draft", publish: false });
      await fails(as(carol), "prayer_library_save", [draft, "Paused draft", "Body", "original", null, null, [], [], true, null], /posting is paused/);
      await fails(as(carol), "prayer_library_status", [draft, "published"], /posting is paused/);
      expect((await rpc<Json>(as(carol), "prayer_library_meta")).posting_restricted).toBe(true);
      await db.raw("delete from community.restrictions where profile_id = $1", [carol]);
      await rpc(as(carol), "prayer_library_status", [draft, "archived"]);
    });
  });

  describe("discovery", () => {
    let gratitude: string;
    let comfortMeal: string;
    let comfortGroup: string;
    let francis: string;

    beforeAll(async () => {
      gratitude = await save(alice, { title: "Thanks at the table", body: "We give thanks for this food.", categories: [cats["purpose:Gratitude"], cats["use:Meals"], cats["topic:Family and children"]] });
      comfortMeal = await save(bob, { title: "Supper in sorrow", body: "Comfort us as we eat together.", categories: [cats["purpose:Comfort"], cats["use:Meals"], cats["topic:Grief and loss"]] });
      comfortGroup = await save(alice, { title: "For our circle", body: "Hold each one in this group with tenderness.", categories: [cats["purpose:Comfort"], cats["use:Small groups"]], refs: ["2 Corinthians 1:3–4"] });
      francis = await save(carol, { title: "Instrument of peace", body: "Where there is hatred, let me sow love.", origin: "shared", source: "Francis of Assisi" });
    });

    it("lists newest published first, with stable ids for ties", async () => {
      await db.raw("update prayer.library_prayers set published_at = '2026-10-01T12:00:00Z' where id = any($1)", [[comfortMeal, comfortGroup]]);
      const order = (await ids(carol)).filter((id) => [gratitude, comfortMeal, comfortGroup, francis].includes(id));
      expect(order.slice(0, 2)).toEqual([francis, gratitude]);
      expect(order.slice(2)).toEqual([comfortMeal, comfortGroup].sort().reverse());
    });

    it("pages with a keyset cursor without repeats or gaps", async () => {
      const all = await ids(carol);
      const seen: string[] = [];
      let page = await list(carol, { limit: 2 });
      seen.push(...page.items.map((c) => c.id));
      while (page.has_more) {
        const last = page.items[page.items.length - 1];
        page = await list(carol, { limit: 2, before: String(last.cursor_at), beforeId: last.id });
        seen.push(...page.items.map((c) => c.id));
      }
      expect(seen).toEqual(all);
    });

    it("searches title, text, categories, Scripture, and attribution (prefixes too)", async () => {
      expect(await ids(carol, { q: "supper" })).toEqual([comfortMeal]);
      expect(await ids(carol, { q: "tender" })).toEqual([comfortGroup]); // text, prefix
      expect(await ids(carol, { q: "Grief" })).toEqual([comfortMeal]); // topic
      expect(new Set(await ids(carol, { q: "small groups" }))).toEqual(new Set([comfortGroup])); // use
      expect(await ids(carol, { q: "Corinthians" })).toEqual([comfortGroup]); // Scripture
      expect(await ids(carol, { q: "assisi" })).toEqual([francis]); // original source
      expect(await ids(carol, { q: "Bob Reader" })).toEqual([comfortMeal]); // contributor
      expect(await ids(carol, { q: "zzzz-nothing" })).toEqual([]);
      expect(await ids(carol, { q: "the" })).toEqual(expect.arrayContaining([gratitude])); // only stop words: title match
      // Query syntax is never interpreted.
      expect(await ids(carol, { q: "supper & | ! (:*" })).toEqual([comfortMeal]);
    });

    it("combines topic, purpose, and use filters, with search", async () => {
      expect(new Set(await ids(carol, { purpose: cats["purpose:Comfort"] }))).toEqual(new Set([comfortMeal, comfortGroup]));
      expect(await ids(carol, { purpose: cats["purpose:Comfort"], use: cats["use:Meals"] })).toEqual([comfortMeal]);
      expect(await ids(carol, { purpose: cats["purpose:Gratitude"], use: cats["use:Meals"], topic: cats["topic:Family and children"] })).toEqual([gratitude]);
      expect(await ids(carol, { purpose: cats["purpose:Gratitude"], topic: cats["topic:Grief and loss"] })).toEqual([]);
      expect(await ids(carol, { q: "comfort", use: cats["use:Small groups"] })).toEqual([comfortGroup]);
    });

    it("shows only my contributions under My prayers", async () => {
      expect(await ids(alice, { view: "mine" })).toEqual(expect.arrayContaining([gratitude, comfortGroup]));
      expect(await ids(alice, { view: "mine" })).not.toContain(comfortMeal);
      await fails(as(alice), "prayer_library_list", ["everything", null, null, null, null, null, null, 20], /valid view/);
    });

    it("keeps bookmarks private to their owner", async () => {
      expect(await rpc(as(carol), "prayer_library_bookmark", [comfortMeal, true])).toBe(true);
      expect(await rpc(as(carol), "prayer_library_bookmark", [comfortMeal, true])).toBe(true); // idempotent
      expect(await ids(carol, { view: "saved" })).toEqual([comfortMeal]);
      expect((await read(carol, comfortMeal)).saved).toBe(true);
      // Nobody else sees Carol's bookmark, not even the contributor; no counts are returned.
      expect(await ids(bob, { view: "saved" })).toEqual([]);
      const forBob = await read(bob, comfortMeal);
      expect(forBob.saved).toBe(false);
      expect(JSON.stringify(forBob)).not.toMatch(/save_count|saved_by/);
      // Saved views combine with search and filters.
      expect(await ids(carol, { view: "saved", q: "supper", use: cats["use:Meals"] })).toEqual([comfortMeal]);
      expect(await rpc(as(carol), "prayer_library_bookmark", [comfortMeal, false])).toBe(false);
      expect(await ids(carol, { view: "saved" })).toEqual([]);
      // No direct table access for members.
      await expect(db.query(as(carol), "select * from prayer.library_saves")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(carol), "select * from prayer.library_prayers")).rejects.toThrow(/permission denied/);
    });

    it("can't bookmark drafts or someone else's unpublished work", async () => {
      const draft = await save(alice, { title: "Unshared draft", publish: false });
      await fails(as(bob), "prayer_library_bookmark", [draft, true], /wasn't found/);
      await fails(as(alice), "prayer_library_bookmark", [draft, true], /wasn't found/);
      await rpc(as(alice), "prayer_library_status", [draft, "archived"]);
    });
  });

  describe("reports and moderation", () => {
    it("lets members report, and prayer moderators hide, restore, and archive with audit records", async () => {
      const id = await save(alice, { title: "Reported prayer", body: "Something someone found unkind." });
      await rpc(as(bob), "prayer_library_bookmark", [id, true]);
      await fails(as(alice), "prayer_library_report", [id, "inappropriate", null], /edit or archive your own/);
      await fails(as(bob), "prayer_library_report", [id, "made-up", null], /Choose a reason/);
      const report = await rpc<string>(as(bob), "prayer_library_report", [id, "permission", "Copied from a book without permission."]);
      expect(await rpc(as(bob), "prayer_library_report", [id, "permission", null])).toBe(report); // no duplicate
      expect((await read(bob, id)).reported).toBe(true);

      // Only prayer moderators (not super admins, not the reporter) review.
      await fails(as(bob), "prayer_library_mod_reports", ["open"], /permission/);
      await fails(as(admin), "prayer_library_mod_reports", ["open"], /permission/);
      const queue = await rpc<Json[]>(as(mod), "prayer_library_mod_reports", ["open"]);
      expect(queue.map((r) => r.id)).toContain(report);
      const detail = await rpc<Json>(as(mod), "prayer_library_mod_report", [report]);
      expect(detail).toMatchObject({ status: "reviewing", reason: "permission", reporter: "Bob Reader", reported: "Alice Contributor" });
      expect((detail.evidence as Json).title).toBe("Reported prayer");

      // Hide: gone from discovery, direct links, and saved lists; the contributor still sees it.
      await fails(as(mod), "prayer_library_mod_action", [id, "hide", "", report], /Give a reason/);
      await fails(as(bob), "prayer_library_mod_action", [id, "hide", "Nope", null], /permission/);
      await rpc(as(mod), "prayer_library_mod_action", [id, "hide", "Shared without permission", report]);
      expect(await ids(bob)).not.toContain(id);
      expect(await ids(bob, { view: "saved" })).not.toContain(id);
      expect(await readable(bob, id)).toBe(false);
      expect(await ids(bob, { q: "Reported" })).toEqual([]);
      expect(await read(alice, id)).toMatchObject({ hidden: true, can_save: false, can_report: false });
      await fails(as(bob), "prayer_library_bookmark", [id, true], /wasn't found/);
      // Editing or republishing never unhides it.
      await save(alice, { id, title: "Reported prayer", body: "Revised." });
      expect(await readable(bob, id)).toBe(false);

      const items = await rpc<Json[]>(as(mod), "prayer_library_mod_items");
      expect(items.find((i) => i.id === id)).toMatchObject({ state: "hidden", last: { reason: "Shared without permission" } });

      // Restore brings it back (and Bob's private bookmark with it).
      await rpc(as(mod), "prayer_library_mod_action", [id, "restore", "Permission confirmed", report]);
      expect(await readable(bob, id)).toBe(true);
      expect(await ids(bob, { view: "saved" })).toContain(id);

      // Moderator archive: the contributor can't republish it; restore can.
      await rpc(as(mod), "prayer_library_mod_action", [id, "archive", "Duplicate of another prayer", null]);
      expect(await readable(bob, id)).toBe(false);
      expect(await read(alice, id)).toMatchObject({ status: "archived", mod_archived: true, can_edit: false });
      await fails(as(alice), "prayer_library_status", [id, "published"], /moderator archived/);
      await rpc(as(mod), "prayer_library_mod_action", [id, "restore", "Not a duplicate after all", null]);
      expect(await read(bob, id)).toMatchObject({ status: "published" });

      await fails(as(mod), "prayer_library_mod_resolve", [report, "actioned", ""], /Record what was decided/);
      await rpc(as(mod), "prayer_library_mod_resolve", [report, "actioned", "Hidden, then restored after permission was confirmed."]);
      expect((await rpc<Json[]>(as(mod), "prayer_library_mod_reports", ["closed"])).map((r) => r.id)).toContain(report);

      const log = await db.raw<{ action: string; reason: string | null }>("select action, reason from prayer.moderation_log where target_id = $1 order by id", [id]);
      expect(log.map((l) => l.action)).toEqual([
        "library_report.viewed",
        "library_prayer.hide",
        "library_prayer.restore",
        "library_prayer.archive",
        "library_prayer.restore",
        "library_report.actioned",
      ]);
      const audit = await db.raw<{ action: string; details: Json }>("select action, details from public.audit_log where target_id = $1 order by id", [id]);
      expect(audit.map((a) => a.action)).toEqual(["prayer.library_hide", "prayer.library_restore", "prayer.library_archive", "prayer.library_restore"]);
      // The audit and moderation logs never hold the prayer's text.
      expect(JSON.stringify(audit) + JSON.stringify(log)).not.toMatch(/unkind|Revised/);
    });

    it("never lets moderators act on drafts or their own contributions", async () => {
      const draft = await save(alice, { title: "Draft only", publish: false });
      await fails(as(mod), "prayer_library_mod_action", [draft, "hide", "Reason", null], /wasn't found/);
      const own = await save(mod, { title: "Moderator's own prayer" });
      await fails(as(mod), "prayer_library_mod_action", [own, "hide", "Reason", null], /Another prayer moderator/);
      await fails(as(alice), "prayer_library_report", [draft, "spam", null], /wasn't found/);
      expect((await read(bob, own)).can_moderate).toBe(false);
      expect((await read(mod, (await save(bob, { title: "Bob's for mod" })))).can_moderate).toBe(true);
    });
  });

  describe("categories", () => {
    it("lets settings managers add, rename, and archive categories, audited", async () => {
      await fails(as(mod), "prayer_library_admin_categories", [], /permission/);
      await fails(as(bob), "prayer_library_category_save", [null, "topic", "Hacked", 1], /permission/);
      const id = await rpc<string>(as(admin), "prayer_library_category_save", [null, "topic", "Travel", 120]);
      await fails(as(admin), "prayer_library_category_save", [null, "topic", "travel", 1], /already in the list/);
      const p = await save(alice, { title: "Journey mercies", categories: [id] });
      expect(await ids(bob, { q: "travel" })).toEqual([p]);
      await rpc(as(admin), "prayer_library_category_save", [id, null, "Travel and journeys", 120]);
      expect(await ids(bob, { q: "journeys" })).toEqual([p]); // reindexed
      await rpc(as(admin), "prayer_library_category_archive", [id, true]);
      const meta = await rpc<{ categories: Array<{ id: string }> }>(as(bob), "prayer_library_meta");
      expect(meta.categories.map((c) => c.id)).not.toContain(id);
      // Existing prayers keep the label; new saves can't use it.
      expect(((await read(bob, p)).categories as Card["categories"]).map((c) => c.name)).toContain("Travel and journeys");
      await fails(as(alice), "prayer_library_save", [null, "New one", "Body", "original", null, null, [], [id], true, null], /no longer available/);
      // Editing a prayer that already has it keeps it.
      await save(alice, { id: p, title: "Journey mercies", body: "Edited.", categories: [id] });
      expect(((await read(bob, p)).categories as Card["categories"]).map((c) => c.id)).toEqual([id]);
      const all = await rpc<Json[]>(as(admin), "prayer_library_admin_categories");
      expect(all.find((c) => c.id === id)).toMatchObject({ archived: true, published_count: 1 });
      const audit = await db.raw<{ action: string }>("select action from public.audit_log where target_id = $1 order by id", [id]);
      expect(audit.map((a) => a.action)).toEqual(["prayer.library_category_created", "prayer.library_category_updated", "prayer.library_category_archived"]);
    });
  });

  it("keeps the contributor's name searchable after a name change", async () => {
    const p = await save(carol, { title: "Evening rest" });
    await db.raw("update public.profiles set preferred_name = 'Caz' where id = $1", [carol]);
    const found = await ids(bob, { q: "caz" });
    expect(found).toContain(p);
    expect((await list(bob, { q: "caz" })).items.every((c) => c.contributor === "Caz")).toBe(true);
  });

  it("leaves prayer requests separate", async () => {
    const before = await db.raw<{ n: number }>("select count(*)::int n from prayer.requests");
    await save(alice, { title: "Library only" });
    expect(await db.raw<{ n: number }>("select count(*)::int n from prayer.requests")).toEqual(before);
    const req = await rpc<string>(as(alice), "prayer_request_save", [null, "A request", "Please pray.", "church", null, false, true, "church", null]);
    expect(await ids(bob, { q: "request" })).not.toContain(req);
    // And nothing is queued for email or push by library activity.
    expect(await db.raw("select 1 from community.notifications where kind like 'prayer_library%'")).toEqual([]);
  });
});
