import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Homepage "Coming up" banners (20261023000100): who may set them, which
 * paths are accepted, and who may read the images. Every person and event
 * here is synthetic.
 */
const TZ = "America/Chicago";
type Json = Record<string, unknown>;

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describeDb("home banners: permissions, paths, and image visibility", () => {
  let db: TestDb;
  let admin: string;
  let coordinator: string;
  let member: string;
  let pending: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };
  const can = async (actor: Actor, name: string) =>
    (await db.query<{ v: boolean }>(actor, "select public.can_view_event_image($1) v", [name]))[0].v;

  async function createEvent(over: Json = {}, publish = true): Promise<{ id: string; occurrence: string }> {
    const saved = await rpc<Json>(as(admin), "events_admin_save", [
      JSON.stringify({
        title: "Synthetic Banner Event",
        description: "Synthetic.",
        audience: "members",
        timezone: TZ,
        all_day: false,
        start_date: ymd(5),
        start_time: "10:00",
        duration_minutes: 60,
        ...over,
      }),
    ]);
    const id = saved.id as string;
    if (publish) await rpc(as(admin), "events_admin_status", [id, "publish", null, null]);
    const series = await rpc<Json>(as(admin), "events_admin_get", [id]);
    return { id, occurrence: (series.occurrences as Json[])[0].id as string };
  }

  beforeAll(async () => {
    db = await TestDb.create();
    admin = await db.createAuthUser("banner.admin@example.test", { fullName: "Banner Admin" });
    coordinator = await db.createAuthUser("banner.coordinator@example.test", { fullName: "Banner Coordinator" });
    member = await db.createAuthUser("banner.member@example.test", { fullName: "Banner Member" });
    pending = await db.createAuthUser("banner.pending@example.test", { fullName: "Banner Pending" });
    for (const id of [admin, coordinator, member]) await db.setStatus(id, "approved");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(coordinator, "event_coordinator");
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("lets only event managers set an event banner", async () => {
    const ev = await createEvent();
    const path = `home/${ev.id}/synthetic-banner-1.webp`;
    await expect(rpc(as(member), "events_admin_home_banner_save", [ev.id, path, "Synthetic", 50, 50])).rejects.toThrow(/permission to manage events/);
    await expect(rpc(anon, "events_admin_home_banner_save", [ev.id, path, "Synthetic", 50, 50])).rejects.toThrow(/permission denied/);
    const r = await rpc<Json>(as(coordinator), "events_admin_home_banner_save", [ev.id, path, "Synthetic banner", 30, 70]);
    expect(r.previous).toBeNull();
    const o = await rpc<Json>(as(member), "events_occurrence", [ev.occurrence]);
    expect(o.home_banner).toEqual({ path, alt: "Synthetic banner", focus_x: 30, focus_y: 70 });
  });

  it("returns the previous path on replace and clears everything on removal", async () => {
    const ev = await createEvent();
    const first = `home/${ev.id}/synthetic-first.webp`;
    const second = `home/${ev.id}/synthetic-second.webp`;
    await rpc(as(admin), "events_admin_home_banner_save", [ev.id, first, "First", 10, 20]);
    expect((await rpc<Json>(as(admin), "events_admin_home_banner_save", [ev.id, second, "Second", null, null])).previous).toBe(first);
    // Focal point kept when not given.
    const kept = await rpc<Json>(as(admin), "events_admin_get", [ev.id]);
    expect([kept.home_banner_focus_x, kept.home_banner_focus_y]).toEqual([10, 20]);
    expect((await rpc<Json>(as(admin), "events_admin_home_banner_save", [ev.id, null, null, null, null])).previous).toBe(second);
    const after = await rpc<Json>(as(admin), "events_admin_get", [ev.id]);
    expect([after.home_banner_path, after.home_banner_alt, after.home_banner_focus_x]).toEqual([null, null, 50]);
  });

  it("refuses paths outside the event's own banner folder, missing alt text, and bad focal points", async () => {
    const ev = await createEvent();
    const other = await createEvent({ cover_path: "x/restricted-cover.webp", cover_alt: "Restricted" });
    for (const bad of ["x/restricted-cover.webp", `home/${other.id}/synthetic-banner.webp`, `home/${ev.id}/../x.webp`, `home/${ev.id}/short.webp`]) {
      await expect(rpc(as(admin), "events_admin_home_banner_save", [ev.id, bad, "Alt", 50, 50])).rejects.toThrow(/isn't valid/);
    }
    const ok = `home/${ev.id}/synthetic-banner-2.webp`;
    await expect(rpc(as(admin), "events_admin_home_banner_save", [ev.id, ok, "  ", 50, 50])).rejects.toThrow(/Describe the banner/);
    await expect(rpc(as(admin), "events_admin_home_banner_save", [ev.id, ok, "Alt", 101, 50])).rejects.toThrow(/focal point/);
    await expect(rpc(as(admin), "events_admin_home_banner_save", ["00000000-0000-4000-8000-000000000000", null, null, null, null])).rejects.toThrow(/wasn't found/);
  });

  it("serves event banners only to people who can see the event", async () => {
    const pub = await createEvent({ audience: "public" });
    const mem = await createEvent({ audience: "members" });
    const draft = await createEvent({ audience: "public" }, false);
    const pubPath = `home/${pub.id}/synthetic-public.webp`;
    const memPath = `home/${mem.id}/synthetic-members.webp`;
    const draftPath = `home/${draft.id}/synthetic-draft.webp`;
    await rpc(as(admin), "events_admin_home_banner_save", [pub.id, pubPath, "Public", 50, 50]);
    await rpc(as(admin), "events_admin_home_banner_save", [mem.id, memPath, "Members", 50, 50]);
    await rpc(as(admin), "events_admin_home_banner_save", [draft.id, draftPath, "Draft", 50, 50]);
    expect(await can(anon, pubPath)).toBe(true);
    expect(await can(anon, memPath)).toBe(false);
    expect(await can(as(pending), memPath)).toBe(false);
    expect(await can(as(member), memPath)).toBe(true);
    expect(await can(as(member), draftPath)).toBe(false);
    expect(await can(as(coordinator), draftPath)).toBe(true);
    // A canceled event takes no new banner; once archived its banner is hidden from members.
    await rpc(as(admin), "events_admin_status", [mem.id, "cancel", null, null]);
    await expect(rpc(as(admin), "events_admin_home_banner_save", [mem.id, `home/${mem.id}/synthetic-new.webp`, "New", 50, 50])).rejects.toThrow(/can't be edited/);
    await rpc(as(admin), "events_admin_status", [mem.id, "archive", null, null]);
    expect(await can(as(member), memPath)).toBe(false);
  });

  it("keeps the church-wide default for approved members and event managers", async () => {
    const path = "home-default/synthetic-default.webp";
    await expect(rpc(as(member), "events_admin_default_banner_save", [path, "Default", 50, 50])).rejects.toThrow(/permission to manage events/);
    await expect(rpc(as(admin), "events_admin_default_banner_save", ["home/x/synthetic-default.webp", "Default", 50, 50])).rejects.toThrow(/isn't valid/);
    await expect(rpc(as(admin), "events_admin_default_banner_save", [path, "", 50, 50])).rejects.toThrow(/Describe the banner/);
    expect((await rpc<Json>(as(coordinator), "events_admin_default_banner_save", [path, "Synthetic default", 40, 60])).previous).toBeNull();

    expect(await rpc(as(member), "events_home_banner_default")).toEqual({ path, alt: "Synthetic default", focus_x: 40, focus_y: 60 });
    expect(await rpc(as(pending), "events_home_banner_default")).toBeNull();
    await expect(rpc(anon, "events_home_banner_default")).rejects.toThrow(/permission denied/);
    expect(await can(as(member), path)).toBe(true);
    expect(await can(as(pending), path)).toBe(false);
    expect(await can(anon, path)).toBe(false);

    const audit = await db.raw<{ action: string; details: Json }>("select action, details from public.audit_log where action = 'event.default_banner_updated'");
    expect(audit.at(-1)?.details).toEqual({ has_image: true, replaced: false });

    expect((await rpc<Json>(as(admin), "events_admin_default_banner_save", [null, null, null, null])).previous).toBe(path);
    expect(await rpc(as(member), "events_home_banner_default")).toBeNull();
    expect(await can(as(member), path)).toBe(false);
  });

  it("doesn't change the calendar sequence or the event's own fields", async () => {
    const ev = await createEvent();
    const before = await rpc<Json>(as(admin), "events_admin_get", [ev.id]);
    await rpc(as(admin), "events_admin_home_banner_save", [ev.id, `home/${ev.id}/synthetic-seq.webp`, "Seq", 50, 50]);
    const after = await rpc<Json>(as(admin), "events_admin_get", [ev.id]);
    expect(after.sequence).toBe(before.sequence);
    expect(after.title).toBe(before.title);
    // A later event save keeps the banner.
    await rpc(as(admin), "events_admin_save", [JSON.stringify({ id: ev.id, title: "Synthetic Banner Event (edited)" })]);
    expect((await rpc<Json>(as(admin), "events_admin_get", [ev.id])).home_banner_path).toBe(`home/${ev.id}/synthetic-seq.webp`);
  });
});
