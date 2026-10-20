import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEventsJob, deliverEventEmails, type ClaimedEmail, type Mailer } from "@/lib/events/jobs";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 4 events against a real database: visibility, recurrence and
 * daylight saving, RSVP capacity under concurrency, waitlists, membership
 * changes, notifications, the scheduler, and calendar feeds. Every person
 * and event here is synthetic.
 */
const SECRET = "test-events-job-secret-0123456789abcdef012345";
const TZ = "America/Chicago";

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

type Json = Record<string, unknown>;

describeDb("events: visibility, recurrence, RSVP, notifications, feeds", () => {
  let db: TestDb;
  let admin: string; // super administrator
  let coordinator: string; // event coordinator only
  let finance: string; // finance administrator only
  const members: string[] = [];
  let pending: string;
  let suspended: string;

  const rpc = async <T = Json>(actor: Actor, fn: string, args: unknown[] = []): Promise<T> => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await db.query<Record<string, T>>(actor, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  };

  const job = () =>
    createEventsJob(SECRET, async (a) => {
      try {
        const rows = await db.query<{ r: unknown }>(anon, "select public.events_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
        return { data: rows[0].r, error: null };
      } catch (err) {
        return { data: null, error: { message: (err as Error).message, code: (err as { code?: string }).code } };
      }
    });

  const baseEvent = (over: Json = {}): Json => ({
    title: "Synthetic Test Event",
    description: "A clearly synthetic event used by automated tests.",
    audience: "members",
    timezone: TZ,
    all_day: false,
    start_date: ymd(10),
    start_time: "18:00",
    duration_minutes: 90,
    rsvp_enabled: true,
    reminder_minutes: [1440],
    ...over,
  });

  async function createEvent(over: Json = {}, publish = true): Promise<{ id: string; occurrences: Json[] }> {
    const saved = await rpc<Json>(as(admin), "events_admin_save", [JSON.stringify(baseEvent(over))]);
    const id = saved.id as string;
    if (publish) await rpc(as(admin), "events_admin_status", [id, "publish", null, null]);
    const series = await rpc<Json>(as(admin), "events_admin_get", [id]);
    return { id, occurrences: series.occurrences as Json[] };
  }

  const firstOcc = async (over: Json = {}, publish = true) => (await createEvent(over, publish)).occurrences[0].id as string;

  beforeAll(async () => {
    db = await TestDb.create();
    await db.raw("insert into events.secrets (name, value) values ('job', $1)", [SECRET]);
    admin = await db.createAuthUser("events.admin@example.test", { fullName: "Events Admin" });
    coordinator = await db.createAuthUser("coordinator@example.test", { fullName: "Event Coordinator" });
    finance = await db.createAuthUser("finance@example.test", { fullName: "Finance Person" });
    for (const id of [admin, coordinator, finance]) await db.setStatus(id, "approved");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(coordinator, "event_coordinator");
    await db.grantRole(finance, "finance_admin");
    for (let i = 0; i < 8; i++) {
      const id = await db.createAuthUser(`member${i}@example.test`, { fullName: `Test Member ${i}` });
      await db.setStatus(id, "approved");
      members.push(id);
    }
    pending = await db.createAuthUser("pending@example.test", { fullName: "Pending Person" });
    suspended = await db.createAuthUser("suspended@example.test", { fullName: "Suspended Person" });
    await db.setStatus(suspended, "approved");
    await db.setStatus(suspended, "suspended");
  });

  afterAll(async () => {
    await db?.destroy();
  });

  describe("access", () => {
    it("keeps the events schema and storage out of direct reach", async () => {
      await expect(db.query(as(members[0]), "select * from events.series")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select * from events.registrations")).rejects.toThrow(/permission denied/);
      await expect(rpc(as(members[0]), "events_admin_save", [JSON.stringify(baseEvent())])).rejects.toThrow(/permission to manage events/);
      await expect(rpc(as(finance), "events_admin_list", ["current"])).rejects.toThrow(/permission to manage events/);
      // The coordinator manages events but nothing else.
      const caps = await db.query<{ e: boolean; m: boolean; f: boolean; r: boolean }>(as(coordinator),
        "select public.has_capability('events.manage') e, public.has_capability('members.view') m, public.has_capability('finance.view') f, public.has_capability('roles.manage') r");
      expect(caps[0]).toEqual({ e: true, m: false, f: false, r: false });
      await expect(rpc(as(coordinator), "events_admin_list", ["current"])).resolves.toBeInstanceOf(Array);
    });

    it("shows public events to everyone and members-only events to approved members only", async () => {
      const pub = await firstOcc({ title: "Synthetic Public Picnic", audience: "public" });
      const mem = await firstOcc({ title: "Synthetic Members Meeting", audience: "members" });
      const from = new Date(Date.now() - 86400000).toISOString();
      const to = new Date(Date.now() + 60 * 86400000).toISOString();
      const ids = async (actor: Actor) => (await rpc<Json[]>(actor, "events_list", [from, to, null, 500])).map((o) => o.id);
      for (const actor of [anon, as(pending), as(suspended)]) {
        const seen = await ids(actor);
        expect(seen).toContain(pub);
        expect(seen).not.toContain(mem);
        expect(await rpc(actor, "events_occurrence", [mem])).toBeNull();
      }
      expect(await ids(as(members[0]))).toEqual(expect.arrayContaining([pub, mem]));
      const detail = await rpc<Json>(as(members[0]), "events_occurrence", [mem]);
      expect(detail.title).toBe("Synthetic Members Meeting");
      // No attendee data in member-facing output.
      expect(Object.keys(detail).filter((k) => /email|attendee|registrations|confirmed_count/.test(k))).toEqual([]);
    });

    it("hides drafts, scheduled-but-unpublished, and archived events", async () => {
      const draft = await firstOcc({ title: "Synthetic Draft", audience: "public" }, false);
      expect(await rpc(anon, "events_occurrence", [draft])).toBeNull();
      expect(await rpc(as(admin), "events_occurrence", [draft])).toBeNull(); // members' view, even for managers
      expect(((await rpc<Json>(as(admin), "events_admin_occurrence", [draft])) as Json).title).toBe("Synthetic Draft");

      const later = await createEvent({ title: "Synthetic Scheduled", audience: "public" }, false);
      await rpc(as(admin), "events_admin_status", [later.id, "publish", new Date(Date.now() + 3600_000).toISOString(), null]);
      expect(await rpc(anon, "events_occurrence", [later.occurrences[0].id])).toBeNull();
      await db.raw("update events.series set publish_at = now() - interval '1 minute' where id = $1", [later.id]);
      expect(await rpc(anon, "events_occurrence", [later.occurrences[0].id])).not.toBeNull();

      await rpc(as(admin), "events_admin_status", [later.id, "archive", null, null]);
      expect(await rpc(anon, "events_occurrence", [later.occurrences[0].id])).toBeNull();
    });

    // Phase 5 enables group audiences; a group event still needs a real group
    // (tests/db/community.test.ts covers group-restricted access).
    it("refuses a group audience without a group", async () => {
      await expect(rpc(as(admin), "events_admin_save", [JSON.stringify(baseEvent({ audience: "group" }))])).rejects.toThrow(/Choose a group/);
      await expect(
        rpc(as(admin), "events_admin_save", [JSON.stringify(baseEvent({ audience: "group", group_id: "00000000-0000-4000-8000-000000000000" }))]),
      ).rejects.toThrow(/Choose a group/);
    });

    it("serves event images only to people who can see the event", async () => {
      const ev = await createEvent({ title: "Synthetic Members Cover", audience: "members", cover_path: "x/members.webp", cover_alt: "Synthetic cover" });
      const pub = await createEvent({ title: "Synthetic Public Cover", audience: "public", cover_path: "x/public.webp", cover_alt: "Synthetic cover" });
      const can = async (actor: Actor, name: string) =>
        (await db.query<{ v: boolean }>(actor, "select public.can_view_event_image($1) v", [name]))[0].v;
      expect(await can(anon, "x/public.webp")).toBe(true);
      expect(await can(anon, "x/members.webp")).toBe(false);
      expect(await can(as(pending), "x/members.webp")).toBe(false);
      expect(await can(as(members[0]), "x/members.webp")).toBe(true);
      await rpc(as(admin), "events_admin_status", [ev.id, "cancel", null, null]);
      await rpc(as(admin), "events_admin_status", [ev.id, "archive", null, null]);
      expect(await can(as(members[0]), "x/members.webp")).toBe(false);
      expect(pub.id).toBeTruthy();
    });
  });

  describe("recurrence and time zones", () => {
    it("keeps a weekly 9:00 AM gathering at 9:00 local across the November DST change", async () => {
      const ev = await createEvent(
        { title: "Synthetic Weekly", start_date: "2026-10-18", start_time: "09:00", recurrence: "weekly", weekdays: [0], until_date: "2026-11-15" },
        false,
      );
      const starts = ev.occurrences.map((o) => new Date(o.starts_at as string).toISOString());
      expect(starts).toEqual([
        "2026-10-18T14:00:00.000Z", // CDT (UTC-5)
        "2026-10-25T14:00:00.000Z",
        "2026-11-01T15:00:00.000Z", // CST (UTC-6) from Nov 1
        "2026-11-08T15:00:00.000Z",
        "2026-11-15T15:00:00.000Z",
      ]);
    });

    it("resolves nonexistent and ambiguous local times as documented", async () => {
      const gap = await createEvent({ title: "Synthetic Gap", start_date: "2027-03-14", start_time: "02:30" }, false);
      expect(gap.occurrences[0].starts_at).toMatch(/^2027-03-14T08:30:00/); // 3:30 AM CDT (moved forward)
      const dup = await createEvent({ title: "Synthetic Repeat", start_date: "2026-11-01", start_time: "01:30" }, false);
      expect(dup.occurrences[0].starts_at).toMatch(/^2026-11-01T07:30:00/); // 1:30 AM CST (later instance)
    });

    it("expands daily, monthly-by-date (skipping short months), ordinal, and count-bounded rules", async () => {
      const daily = await createEvent({ start_date: "2026-12-01", recurrence: "daily", interval_count: 2, occurrence_limit: 4 }, false);
      expect(daily.occurrences.map((o) => o.occurrence_key)).toEqual(["2026-12-01", "2026-12-03", "2026-12-05", "2026-12-07"]);
      const monthly31 = await createEvent({ start_date: "2027-01-31", recurrence: "monthly", monthly_mode: "day", until_date: "2027-06-30" }, false);
      expect(monthly31.occurrences.map((o) => o.occurrence_key)).toEqual(["2027-01-31", "2027-03-31", "2027-05-31"]);
      const lastSunday = await createEvent(
        { start_date: "2027-01-31", recurrence: "monthly", monthly_mode: "ordinal", month_ordinal: -1, occurrence_limit: 3 },
        false,
      );
      expect(lastSunday.occurrences.map((o) => o.occurrence_key)).toEqual(["2027-01-31", "2027-02-28", "2027-03-28"]);
      const secondTue = await createEvent(
        { start_date: "2027-02-09", recurrence: "monthly", monthly_mode: "ordinal", month_ordinal: 2, occurrence_limit: 3 },
        false,
      );
      expect(secondTue.occurrences.map((o) => o.occurrence_key)).toEqual(["2027-02-09", "2027-03-09", "2027-04-13"]);
    });

    it("bounds expansion and rejects unbounded or oversized rules", async () => {
      await expect(rpc(as(admin), "events_admin_save", [JSON.stringify(baseEvent({ recurrence: "daily" }))])).rejects.toThrow(/series_recurrence_end/);
      await expect(
        rpc(as(admin), "events_admin_save", [JSON.stringify(baseEvent({ recurrence: "daily", until_date: "2030-01-01" }))]),
      ).rejects.toThrow(/series_until_range/);
      const capped = await createEvent({ start_date: "2027-01-01", recurrence: "daily", occurrence_limit: 200 }, false);
      expect(capped.occurrences).toHaveLength(200);
    });

    it("places all-day events on whole local days", async () => {
      const ev = await createEvent({ all_day: true, start_time: null, duration_minutes: null, day_count: 2, start_date: "2026-11-07" }, false);
      expect(ev.occurrences[0].starts_at).toMatch(/^2026-11-07T06:00:00/);
      expect(ev.occurrences[0].ends_at).toMatch(/^2026-11-09T06:00:00/);
    });
  });

  describe("registration", () => {
    it("confirms up to capacity, waitlists the rest in order, and promotes automatically", async () => {
      const occ = await firstOcc({ title: "Synthetic Capacity", capacity: 2, waitlist_enabled: true });
      const r = [];
      for (const m of members.slice(0, 5)) r.push(((await rpc<Json>(as(m), "events_rsvp", [occ])) as Json).status);
      expect(r).toEqual(["confirmed", "confirmed", "waitlisted", "waitlisted", "waitlisted"]);
      // Duplicate request: no second registration.
      expect(await rpc<Json>(as(members[0]), "events_rsvp", [occ])).toMatchObject({ status: "confirmed", already: true });
      expect((await rpc<Json>(as(members[3]), "events_occurrence", [occ])).my_position).toBe(2);

      await rpc(as(members[1]), "events_cancel_rsvp", [occ]);
      const people = await rpc<Json[]>(as(admin), "events_admin_attendees", [occ]);
      const statusOf = (id: string) => people.find((p) => p.profile_id === id)?.status;
      expect(statusOf(members[2])).toBe("confirmed"); // first in line
      expect(statusOf(members[3])).toBe("waitlisted");
      expect((await rpc<Json>(as(members[3]), "events_occurrence", [occ])).my_position).toBe(1);
      const kinds = await db.raw<{ kind: string }>("select kind from events.outbox where occurrence_id = $1 and profile_id = $2 order by created_at", [occ, members[2]]);
      expect(kinds.map((k) => k.kind)).toEqual(["waitlisted", "promoted"]);
    });

    it("never overbooks under concurrent requests", async () => {
      const occ = await firstOcc({ title: "Synthetic Race", capacity: 3, waitlist_enabled: false });
      const clients = await Promise.all(members.map(() => db.connect()));
      const results = await Promise.allSettled(
        clients.map(async (c, i) => {
          await c.query("begin");
          await c.query("set local role authenticated");
          await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: members[i], role: "authenticated" })]);
          try {
            const res = await c.query("select public.events_rsvp($1) r", [occ]);
            await c.query("commit");
            return res.rows[0].r.status as string;
          } catch (err) {
            await c.query("rollback");
            throw err;
          }
        }),
      );
      await Promise.all(clients.map((c) => c.end()));
      const confirmed = results.filter((x) => x.status === "fulfilled" && x.value === "confirmed").length;
      const full = results.filter((x) => x.status === "rejected" && /full/.test(String((x as PromiseRejectedResult).reason))).length;
      expect(confirmed).toBe(3);
      expect(full).toBe(members.length - 3);
      const count = await db.raw<{ n: string }>("select count(*) n from events.registrations where occurrence_id = $1 and status = 'confirmed'", [occ]);
      expect(Number(count[0].n)).toBe(3);
    });

    it("enforces deadlines, cancellation, eligibility, and registration settings", async () => {
      const closed = await firstOcc({ rsvp_close_minutes: 30 * 24 * 60 });
      await expect(rpc(as(members[0]), "events_rsvp", [closed])).rejects.toThrow(/closed/);
      const noRsvp = await firstOcc({ rsvp_enabled: false });
      await expect(rpc(as(members[0]), "events_rsvp", [noRsvp])).rejects.toThrow(/doesn't take registrations/);
      const mem = await firstOcc({ audience: "members" });
      await expect(rpc(as(pending), "events_rsvp", [mem])).rejects.toThrow(/approved members/);
      await expect(rpc(anon, "events_rsvp", [mem])).rejects.toThrow(/permission denied/);
      const ev = await createEvent({ title: "Synthetic Canceled" });
      await rpc(as(admin), "events_admin_status", [ev.id, "cancel", null, "Synthetic reason"]);
      await expect(rpc(as(members[0]), "events_rsvp", [ev.occurrences[0].id])).rejects.toThrow(/canceled/);
      // Someone else's registration can't be touched: cancel only affects the caller's own.
      const own = await firstOcc();
      await rpc(as(members[0]), "events_rsvp", [own]);
      await rpc(as(members[1]), "events_cancel_rsvp", [own]);
      expect((await rpc<Json>(as(members[0]), "events_occurrence", [own])).my_status).toBe("confirmed");
    });

    it("keeps confirmed people when capacity is reduced and fills again when it grows", async () => {
      const ev = await createEvent({ title: "Synthetic Shrink", capacity: 3, waitlist_enabled: true });
      const occ = ev.occurrences[0].id as string;
      for (const m of members.slice(0, 3)) await rpc(as(m), "events_rsvp", [occ]);
      await rpc(as(admin), "events_admin_save", [JSON.stringify({ ...baseEvent({ title: "Synthetic Shrink", capacity: 2, waitlist_enabled: true }), id: ev.id })]);
      const after = await rpc<Json[]>(as(admin), "events_admin_attendees", [occ]);
      expect(after.filter((p) => p.status === "confirmed")).toHaveLength(3);
      expect(((await rpc<Json>(as(members[3]), "events_rsvp", [occ])) as Json).status).toBe("waitlisted");
      await rpc(as(members[0]), "events_cancel_rsvp", [occ]); // 2 confirmed = capacity: no promotion
      expect((await rpc<Json>(as(members[3]), "events_occurrence", [occ])).my_status).toBe("waitlisted");
      await rpc(as(admin), "events_admin_save", [JSON.stringify({ ...baseEvent({ title: "Synthetic Shrink", capacity: 5, waitlist_enabled: true }), id: ev.id })]);
      expect((await rpc<Json>(as(members[3]), "events_occurrence", [occ])).my_status).toBe("confirmed");
    });

    it("releases registrations when a member is suspended, rechecking eligibility before promotion", async () => {
      const temp = await db.createAuthUser("temp.member@example.test", { fullName: "Temporary Member" });
      const temp2 = await db.createAuthUser("temp.member2@example.test", { fullName: "Temporary Member Two" });
      await db.setStatus(temp, "approved");
      await db.setStatus(temp2, "approved");
      const occ = await firstOcc({ title: "Synthetic Suspension", capacity: 1, waitlist_enabled: true });
      await rpc(as(temp), "events_rsvp", [occ]);
      await rpc(as(temp2), "events_rsvp", [occ]); // waitlisted
      await rpc(as(members[5]), "events_rsvp", [occ]); // waitlisted behind temp2
      await db.setStatus(temp2, "suspended"); // loses waitlist place
      await db.setStatus(temp, "suspended"); // releases the confirmed place
      const people = await rpc<Json[]>(as(admin), "events_admin_attendees", [occ]);
      const by = (id: string) => people.find((p) => p.profile_id === id);
      expect(by(temp)).toMatchObject({ status: "canceled", cancel_reason: "ineligible" });
      expect(by(temp2)).toMatchObject({ status: "canceled", cancel_reason: "ineligible" });
      expect(by(members[5])?.status).toBe("confirmed");
      const queued = await db.raw<{ n: string }>("select count(*) n from events.outbox where profile_id = $1 and status = 'pending'", [temp]);
      expect(Number(queued[0].n)).toBe(0);
    });

    it("records administrative registrations and cancellations with an audit entry", async () => {
      const occ = await firstOcc({ title: "Synthetic Admin RSVP", capacity: 1, waitlist_enabled: false });
      await rpc(as(members[0]), "events_rsvp", [occ]);
      await expect(rpc(as(coordinator), "events_admin_register", [occ, members[1], "Phoned in", false])).rejects.toThrow(/full/);
      const added = await rpc<Json>(as(coordinator), "events_admin_register", [occ, members[1], "Phoned in", true]);
      expect(added.status).toBe("confirmed");
      await expect(rpc(as(coordinator), "events_admin_register", [occ, pending, "Test", true])).rejects.toThrow(/approved member/);
      await rpc(as(coordinator), "events_admin_cancel_registration", [added.registration_id, "Asked by phone"]);
      const rows = await rpc<Json[]>(as(coordinator), "events_admin_export", [occ]);
      expect(rows.length).toBe(2);
      const audit = await db.raw<{ action: string; details: Json }>(
        "select action, details from public.audit_log where target_id = $1 order by id", [occ]);
      expect(audit.map((a) => a.action)).toEqual(["event.registration_added", "event.registration_canceled", "event.attendees_exported"]);
      expect(audit[0].details).toMatchObject({ over_capacity: true, reason: "Phoned in" });
      expect(JSON.stringify(audit)).not.toMatch(/@example\.test/);
    });
  });

  describe("editing, cancellation, and notifications", () => {
    it("preserves occurrence ids and registrations when a series is edited, and notifies only for meaningful changes", async () => {
      const start = ymd(14);
      const weekly = { title: "Synthetic Series", start_date: start, start_time: "19:00", recurrence: "weekly", weekdays: [new Date(`${start}T12:00:00Z`).getUTCDay()], occurrence_limit: 4 };
      const ev = await createEvent(weekly);
      const [first, second, , fourth] = ev.occurrences.map((o) => o.id as string);
      await rpc(as(members[0]), "events_rsvp", [first]);
      await rpc(as(members[0]), "events_rsvp", [fourth]);

      // Wording-only change: no emails.
      await rpc(as(admin), "events_admin_save", [JSON.stringify({ ...baseEvent(weekly), description: "New synthetic wording", id: ev.id })]);
      expect(await db.raw("select 1 from events.outbox where kind = 'changed' and profile_id = $1", [members[0]])).toHaveLength(0);

      // Time change: same ids, registrations kept, registrants told.
      await rpc(as(admin), "events_admin_save", [JSON.stringify({ ...baseEvent({ ...weekly, start_time: "19:30" }), id: ev.id })]);
      const after = await rpc<Json>(as(admin), "events_admin_get", [ev.id]);
      expect((after.occurrences as Json[]).map((o) => o.id)).toEqual(ev.occurrences.map((o) => o.id));
      expect((await rpc<Json>(as(members[0]), "events_occurrence", [first])).my_status).toBe("confirmed");
      const changed = await db.raw<{ occurrence_id: string }>("select occurrence_id from events.outbox where kind = 'changed' and profile_id = $1", [members[0]]);
      expect(changed.map((c) => c.occurrence_id).sort()).toEqual([first, fourth].sort());

      // Shorten the series: the registered date is kept (canceled), the empty one is removed.
      await rpc(as(admin), "events_admin_save", [JSON.stringify({ ...baseEvent({ ...weekly, start_time: "19:30", occurrence_limit: 2 }), id: ev.id })]);
      const shortened = (await rpc<Json>(as(admin), "events_admin_get", [ev.id])).occurrences as Json[];
      expect(shortened.map((o) => o.id)).toEqual([first, second, fourth]);
      expect(shortened.find((o) => o.id === fourth)).toMatchObject({ status: "canceled", orphaned: true });
      expect(await db.raw("select 1 from events.outbox where kind = 'occurrence_canceled' and occurrence_id = $1", [fourth])).toHaveLength(1);
    });

    it("lets one date be moved or canceled without touching the series", async () => {
      const start = ymd(21);
      const weekly = { title: "Synthetic Detach", start_date: start, start_time: "10:00", recurrence: "weekly", weekdays: [new Date(`${start}T12:00:00Z`).getUTCDay()], occurrence_limit: 3 };
      const ev = await createEvent(weekly);
      const [a, b] = ev.occurrences.map((o) => o.id as string);
      await rpc(as(members[1]), "events_rsvp", [a]);
      await rpc(as(admin), "events_admin_occurrence_save", [a, JSON.stringify({ override_start_time: "11:00", override_location_name: "Synthetic Hall B" })]);
      await rpc(as(admin), "events_admin_save", [JSON.stringify({ ...baseEvent({ ...weekly, start_time: "09:00" }), id: ev.id })]);
      const detached = await rpc<Json>(as(members[1]), "events_occurrence", [a]);
      expect(detached.location_name).toBe("Synthetic Hall B");
      expect(new Date(detached.starts_at as string).toISOString()).toMatch(/T(16|17):00:00/); // 11:00 local
      await rpc(as(admin), "events_admin_occurrence_cancel", [b, "Synthetic holiday"]);
      expect((await rpc<Json>(as(members[1]), "events_occurrence", [b])).status).toBe("canceled");
      await expect(rpc(as(members[1]), "events_rsvp", [b])).rejects.toThrow(/canceled/);
    });

    it("blocks unpublishing with registrations, and cancels an event for everyone with a record kept", async () => {
      const ev = await createEvent({ title: "Synthetic Cancel Me" });
      const occ = ev.occurrences[0].id as string;
      await rpc(as(members[2]), "events_rsvp", [occ]);
      await expect(rpc(as(admin), "events_admin_status", [ev.id, "unpublish", null, null])).rejects.toThrow(/Cancel it instead/);
      await expect(rpc(as(admin), "events_admin_status", [ev.id, "archive", null, null])).rejects.toThrow(/Cancel the event/);
      await rpc(as(admin), "events_admin_status", [ev.id, "cancel", null, "Synthetic weather"]);
      const seen = await rpc<Json>(as(members[2]), "events_occurrence", [occ]);
      expect(seen).toMatchObject({ status: "canceled", cancel_reason: "Synthetic weather" });
      expect(await db.raw("select 1 from events.outbox where kind = 'event_canceled' and occurrence_id = $1", [occ])).toHaveLength(1);
      await expect(rpc(as(admin), "events_admin_save", [JSON.stringify({ ...baseEvent(), id: ev.id })])).rejects.toThrow(/can't be edited/);
    });
  });

  describe("scheduler and email delivery", () => {
    it("queues each reminder once, honors preferences, and needs a valid signature", async () => {
      const soon = new Date(Date.now() + 30 * 60_000);
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(soon);
      const g = (t: string) => local.find((p) => p.type === t)!.value;
      const occ = await firstOcc({ title: "Synthetic Reminder", start_date: `${g("year")}-${g("month")}-${g("day")}`, start_time: `${g("hour")}:${g("minute")}`, reminder_minutes: [60] });
      await rpc(as(members[6]), "events_rsvp", [occ]);
      await rpc(as(members[7]), "events_rsvp", [occ]);
      await rpc(as(members[7]), "events_set_reminders", [false]);
      await db.raw("update events.registrations set confirmed_at = now() - interval '1 day' where occurrence_id = $1", [occ]);

      const j = job();
      await j("tick", {});
      await j("tick", {});
      const reminders = await db.raw<{ profile_id: string }>("select profile_id from events.outbox where kind = 'reminder' and occurrence_id = $1", [occ]);
      expect(reminders.map((r) => r.profile_id)).toEqual([members[6]]);

      const forged = createEventsJob("x".repeat(48), async (a) => {
        try {
          const rows = await db.query<{ r: unknown }>(anon, "select public.events_job($1, $2, $3, $4) as r", [a.p_op, a.p_payload, a.p_ts, a.p_sig]);
          return { data: rows[0].r, error: null };
        } catch (err) {
          return { data: null, error: { message: (err as Error).message } };
        }
      });
      await expect(forged("tick", {})).rejects.toThrow(/Invalid signature/);
    });

    it("sends each message once, retries failures, suppresses non-allowlisted addresses, and skips people who lost access", async () => {
      const occ = await firstOcc({ title: "Synthetic Mail" });
      const loser = await db.createAuthUser("loses.access@example.test", { fullName: "Loses Access" });
      await db.setStatus(loser, "approved");
      await rpc(as(members[0]), "events_rsvp", [occ]);
      await rpc(as(members[1]), "events_rsvp", [occ]);
      await rpc(as(loser), "events_rsvp", [occ]);
      // Simulate access loss without the cancellation trigger (e.g. a later audience change).
      await db.raw("alter table public.profiles disable trigger events_on_profile_status");
      await db.setStatus(loser, "pending");
      await db.raw("alter table public.profiles enable trigger events_on_profile_status");

      const sent: string[] = [];
      let failNext = true;
      const mailer: Mailer = {
        async send(m) {
          if (m.to === "member0@example.test" && failNext) {
            failNext = false;
            return { ok: false, error: "temporary" };
          }
          sent.push(`${m.to}|${m.subject}|${m.idempotencyKey}`);
          return { ok: true, id: "synthetic" };
        },
      };
      const deps = { job: job(), mailer, allowlist: ["member0@example.test", "loses.access@example.test"], siteUrl: "https://example.test", churchName: "The Gathering", testMode: true };
      const first = await deliverEventEmails(deps, { occurrence: occ });
      expect(first).toMatchObject({ sent: 0, failed: 1, suppressed: 1 }); // member1 not allowlisted
      await db.raw("update events.outbox set next_attempt_at = now() where occurrence_id = $1 and status = 'failed'", [occ]);
      const second = await deliverEventEmails(deps, { occurrence: occ });
      expect(second.sent).toBe(1);
      await deliverEventEmails(deps, { occurrence: occ });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatch(/^member0@example\.test\|\[TEST\] You're registered: Synthetic Mail\|event-confirmed:/);
      const loserRow = await db.raw<{ status: string }>("select status from events.outbox where occurrence_id = $1 and profile_id = $2", [occ, loser]);
      expect(loserRow[0].status).toBe("skipped");
    });

    it("hands the mailer only rechecked, attendee-free data", async () => {
      const occ = await firstOcc({ title: "Synthetic Claim" });
      await rpc(as(members[4]), "events_rsvp", [occ]);
      const claimed = await job()<ClaimedEmail[]>("email_claim", { occurrence: occ, limit: 5 });
      expect(claimed).toHaveLength(1);
      expect(claimed[0].occurrence.title).toBe("Synthetic Claim");
      expect(JSON.stringify(claimed[0].occurrence)).not.toMatch(/member\d@example/);
    });
  });

  describe("calendar feeds", () => {
    it("serves a private feed of confirmed registrations until the token is revoked or rotated", async () => {
      const occ = await firstOcc({ title: "Synthetic Feed Item", audience: "members" });
      const other = await firstOcc({ title: "Synthetic Not Registered", audience: "members" });
      await rpc(as(members[3]), "events_rsvp", [occ]);
      const token = await rpc<string>(as(members[3]), "events_feed_token_rotate");
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const stored = await db.raw<{ token_hash: Buffer }>("select token_hash from events.feed_tokens where profile_id = $1", [members[3]]);
      expect(stored[0].token_hash.toString("utf8")).not.toContain(token);
      const feed = await rpc<Json[]>(anon, "events_feed_private", [token]);
      expect(feed.map((o) => o.id)).toContain(occ);
      expect(feed.map((o) => o.id)).not.toContain(other);
      expect(JSON.stringify(feed)).not.toMatch(/@example\.test/);

      const rotated = await rpc<string>(as(members[3]), "events_feed_token_rotate");
      expect(await rpc(anon, "events_feed_private", [token])).toBeNull();
      expect(await rpc(anon, "events_feed_private", [rotated])).not.toBeNull();
      await rpc(as(members[3]), "events_feed_token_revoke");
      expect(await rpc(anon, "events_feed_private", [rotated])).toBeNull();
      expect(await rpc(anon, "events_feed_private", ["not-a-token"])).toBeNull();
    });

    it("stops serving a private feed when the member is no longer approved", async () => {
      const person = await db.createAuthUser("feed.person@example.test", { fullName: "Feed Person" });
      await db.setStatus(person, "approved");
      const token = await rpc<string>(as(person), "events_feed_token_rotate");
      expect(await rpc(anon, "events_feed_private", [token])).toEqual([]);
      await db.setStatus(person, "suspended");
      expect(await rpc(anon, "events_feed_private", [token])).toBeNull();
      await expect(rpc(as(pending), "events_feed_token_rotate")).rejects.toThrow(/approved members/);
    });

    it("publishes the public calendar only when enabled and only with public events", async () => {
      await firstOcc({ title: "Synthetic Public Feed", audience: "public" });
      await firstOcc({ title: "Synthetic Members Feed", audience: "members" });
      expect(await rpc(anon, "events_feed_public")).toBeNull();
      await rpc(as(admin), "events_admin_settings_save", [true, [1440]]);
      const items = await rpc<Json[]>(anon, "events_feed_public");
      expect(items.every((o) => o.audience === "public")).toBe(true);
      expect(items.map((o) => o.title)).toContain("Synthetic Public Feed");
      expect(items.map((o) => o.title)).not.toContain("Synthetic Members Feed");
      await rpc(as(admin), "events_admin_settings_save", [false, [1440]]);
    });
  });
});
