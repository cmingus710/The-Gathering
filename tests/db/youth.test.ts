import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSourceFile } from "@/lib/bible/source-import";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 10 youth ministry and families against a real database: versioned
 * policy with safe defaults, verified guardianship (never from households),
 * per-child and per-capability guardian permissions, restriction,
 * suspension and revocation, child profiles kept out of every adult path,
 * policy-gated independent youth accounts (eligibility, minimum age with a
 * recorded birth date, verified email, guardian authorization, fresh
 * accounts only), fail-closed adult checks for youth accounts, scoped
 * leaders and the last-leader rule, youth events with versioned consent,
 * renewal, withdrawal, capacity and waitlists, restricted logistics,
 * supervised discussions and reports about leaders, no direct-message
 * paths, journal privacy, parent-versus-child practice, progress sharing,
 * photo consent with gallery moderation, adult transition, access
 * revocation, and generic notifications.
 *
 * Every person here is synthetic.
 */
type Json = Record<string, unknown>;
const FIXTURE = readFileSync(path.resolve(__dirname, "../fixtures/bible/web-sample.csv"), "utf8");
const TZ = "America/Chicago";
const ymd = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const ALL = {
  manage_profile: true,
  register: true,
  sign_forms: true,
  media_consent: true,
  view_progress: true,
  practice: true,
  manage_account: true,
  receive_updates: true,
};

describeDb("Youth ministry and families", () => {
  let db: TestDb;
  let admin: string; // super administrator (no youth capabilities implicitly)
  let policyA: string;
  let policyB: string;
  let famAdmin: string;
  let famAdmin2: string;
  let ministry: string; // youth_ministry_admin
  let forms: string; // youth_forms_admin
  let logistics: string; // youth_event_logistics
  let reviewer: string; // youth_media_reviewer + gallery_moderator
  let safeguard: string; // youth_safeguarding
  let leader1: string;
  let leader2: string;
  let leader3: string; // leads groupB only
  let parentA: string;
  let parentB: string;
  let housemate: string; // shares parentA's household, never verified
  let stranger: string;
  let pendingAdult: string;
  let groupA: string;
  let groupB: string;
  let kidA: string;
  let kidB: string;
  let kidC: string;
  let kidD: string;
  let web: string;
  let collection: string;
  let item: string;

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
  const j = (v: unknown) => JSON.stringify(v);
  /** Set-returning functions (directory, member search). */
  const setOf = async (actor: Actor, fn: string, args: unknown[] = []) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    return JSON.stringify(await db.query(actor, `select * from public.${fn}(${placeholders})`, args));
  };
  const mk = async (email: string, name: string, state: "approved" | "pending" = "approved") => {
    const id = await db.createAuthUser(email, { fullName: name });
    if (state === "approved") await db.setStatus(id, "approved");
    return id;
  };
  const approvePolicy = async (settings: Json) => {
    const p = await rpc<Json>(as(policyA), "youth_admin_policy_save", [null, j({ title: "Synthetic youth policy", body: "Synthetic text.", settings })]);
    await rpc(as(policyB), "youth_admin_policy_approve", [p.id, `approve version ${p.version}`, "Synthetic board minutes"]);
    return p;
  };
  const request = (who: string, p: Json) => rpc<Json>(as(who), "youth_guardian_request", [j(p)]);
  const decide = (reqId: string, p: Json, by = famAdmin) => rpc<Json>(as(by), "youth_admin_request_decide", [reqId, j(p)]);
  const notices = (who: string, kind: string) =>
    db.raw<{ id: string; kind: string; youth_child_id: string | null }>(
      "select id, kind, youth_child_id from community.notifications where profile_id = $1 and kind = $2 order by created_at",
      [who, kind],
    );

  async function youthEvent(over: Json = {}, settings: Json = {}) {
    const saved = await rpc<Json>(as(admin), "events_admin_save", [
      j({
        title: "Synthetic Youth Night",
        description: "A synthetic event.",
        audience: "members",
        timezone: TZ,
        all_day: false,
        start_date: ymd(5),
        start_time: "18:00",
        duration_minutes: 90,
        rsvp_enabled: true,
        reminder_minutes: [1440],
        ...over,
      }),
    ]);
    const series = saved.id as string;
    await rpc(as(forms), "youth_admin_event_set", [series, j({ group_id: groupA, ...settings })]);
    await rpc(as(admin), "events_admin_status", [series, "publish", null, null]);
    const occ = (await db.raw<{ id: string }>("select id from events.occurrences where series_id = $1 order by starts_at", [series]))[0].id;
    return { series, occ };
  }

  beforeAll(async () => {
    db = await TestDb.create();
    admin = await mk("y.admin@example.test", "Synthetic Admin");
    policyA = await mk("y.policya@example.test", "Synthetic Policy Drafter");
    policyB = await mk("y.policyb@example.test", "Synthetic Policy Approver");
    famAdmin = await mk("y.family@example.test", "Synthetic Family Admin");
    famAdmin2 = await mk("y.family2@example.test", "Synthetic Family Admin Two");
    ministry = await mk("y.ministry@example.test", "Synthetic Ministry Admin");
    forms = await mk("y.forms@example.test", "Synthetic Forms Admin");
    logistics = await mk("y.logistics@example.test", "Synthetic Logistics");
    reviewer = await mk("y.reviewer@example.test", "Synthetic Consent Reviewer");
    safeguard = await mk("y.safe@example.test", "Synthetic Safeguarding");
    leader1 = await mk("y.leader1@example.test", "Synthetic Leader One");
    leader2 = await mk("y.leader2@example.test", "Synthetic Leader Two");
    leader3 = await mk("y.leader3@example.test", "Synthetic Leader Three");
    parentA = await mk("y.parenta@example.test", "Synthetic Parent A");
    parentB = await mk("y.parentb@example.test", "Synthetic Parent B");
    housemate = await mk("y.housemate@example.test", "Synthetic Housemate");
    stranger = await mk("y.stranger@example.test", "Synthetic Stranger");
    pendingAdult = await mk("y.pending@example.test", "Synthetic Pending", "pending");
    await db.grantRole(admin, "super_admin");
    for (const [who, role] of [
      [policyA, "youth_policy_admin"], [policyB, "youth_policy_admin"], [famAdmin, "family_admin"], [famAdmin2, "family_admin"],
      [ministry, "youth_ministry_admin"], [forms, "youth_forms_admin"], [logistics, "youth_event_logistics"],
      [reviewer, "youth_media_reviewer"], [reviewer, "gallery_moderator"], [safeguard, "youth_safeguarding"],
      [leader1, "youth_leader"], [leader2, "youth_leader"], [leader3, "youth_leader"],
    ]) await db.grantRole(who, role);
    const h = await rpc<string>(as(parentA), "household_create", ["Synthetic Family Household"]);
    await db.raw("insert into public.household_members (household_id, profile_id) values ($1, $2)", [h, housemate]);

    // Approved scripture source (Phase 8) and a church memory collection (Phase 9).
    web = (await db.raw<{ id: string }>(
      `insert into bible.translations (code, name, attribution, copyright, rights, rights_confirmed_at, status, text_version)
       values ('WEB', 'World English Bible', 'World English Bible (WEB), public domain.', 'Public domain', 'public_domain', now(), 'draft', 1) returning id`,
    ))[0].id;
    const rows = parseSourceFile(FIXTURE, "csv").filter((r) => r.book && r.chapter && r.verse);
    for (const r of rows) {
      await db.raw("insert into bible.verses (translation_id, book_code, chapter, verse, text, omitted, heading, para_start, poetry) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
        web, r.book, r.chapter, r.verse, r.text, r.text.trim() === "", r.heading, r.para, r.poetry,
      ]);
    }
    await db.raw("update bible.translations set verse_count = $2, status = 'active' where id = $1", [web, rows.length]);
    await db.raw("update bible.settings set default_translation_id = $1", [web]);
    const c = await rpc<Json>(as(admin), "memory_admin_collection_save", [null, j({ title: "Synthetic Youth Verses", translation_id: web }), randomUUID()]);
    collection = c.id as string;
    const it1 = await rpc<Json>(as(admin), "memory_admin_item_add", [collection, j({ book: "JHN", sc: 3, sv: 16, ec: 3, ev: 16 })]);
    item = (it1.id ?? (it1.item as Json)?.id) as string;
    await rpc(as(admin), "memory_admin_collection_status", [collection, "publish", null]);
    if (!item) item = (await db.raw<{ id: string }>("select id from memory.items where collection_id = $1", [collection]))[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("access", () => {
    it("keeps the youth schema closed to clients", async () => {
      await expect(db.query(as(parentA), "select * from youth.children")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(admin), "select * from youth.guardianships")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select public.youth_family()")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(parentA), "select youth.guardian_can($1, $2)", [randomUUID(), parentA])).rejects.toThrow(/permission denied/);
    });

    it("gives super administrators no youth or family capability implicitly", async () => {
      const caps = (await db.query<{ c: string }>(as(admin), "select c from public.my_capabilities() c")).map((r) => r.c);
      expect(caps.filter((c) => c.startsWith("youth.") || c.startsWith("family."))).toEqual([]);
      await fails(as(admin), "youth_admin_requests", ["pending"], /permission/);
      await fails(as(admin), "youth_admin_children", [null], /permission/);
    });

    it("refuses pending accounts and visitors", async () => {
      await fails(as(pendingAdult), "youth_family", [], /approved adult/);
      await fails(as(pendingAdult), "youth_guardian_request", [j({ kind: "new_child", child_name: "X", relationship: "parent" })], /approved adult/);
    });
  });

  describe("policy", () => {
    it("uses safe defaults until a version is approved", async () => {
      const p = await rpc<Json>(as(parentA), "youth_policy");
      expect(p.approved).toBe(false);
      expect(p.settings).toMatchObject({
        independent_accounts: false, youth_rsvp: false, youth_discussions: false, group_prayer: false,
        progress_sharing: "off", public_media_consent: false, adult_transition: false, minimum_age_years: null,
        guardian_authorization_required: true, multiple_guardians: false, logistics_retention_days: null,
      });
    });

    it("validates drafts and needs a second person, the phrase, and a reference to approve", async () => {
      await fails(as(policyA), "youth_admin_policy_save", [null, j({ title: "T", settings: { unknown_key: true } })], /Unknown setting/);
      await fails(as(policyA), "youth_admin_policy_save", [null, j({ title: "T", settings: { independent_accounts: true } })], /eligible/);
      await fails(as(policyA), "youth_admin_policy_save", [null, j({ title: "T", settings: { group_prayer: true } })], /Group prayer/);
      await fails(as(famAdmin), "youth_admin_policy_save", [null, j({ title: "T", settings: {} })], /permission/);
      const d = await rpc<Json>(as(policyA), "youth_admin_policy_save", [null, j({ title: "Draft one", settings: {} })]);
      await fails(as(policyA), "youth_admin_policy_approve", [d.id, `approve version ${d.version}`, "Ref"], /other than the last editor/);
      await fails(as(policyB), "youth_admin_policy_approve", [d.id, "approve", "Ref"], /Type "approve version/);
      await fails(as(policyB), "youth_admin_policy_approve", [d.id, `approve version ${d.version}`, ""], /Record where/);
      await rpc(as(policyB), "youth_admin_policy_approve", [d.id, `approve version ${d.version}`, "Synthetic minutes"]);
      const second = await approvePolicy({});
      const all = (await rpc<Json>(as(policyA), "youth_admin_policies")).policies as Json[];
      expect(all.filter((p) => p.status === "approved").map((p) => p.version)).toEqual([second.version]);
      expect(all.find((p) => p.id === d.id)?.status).toBe("retired");
      await fails(as(policyA), "youth_admin_policy_save", [d.id, j({ title: "Edit approved", settings: {} })], /Only draft/);
    });
  });

  describe("guardian requests and verification", () => {
    it("never establishes guardianship from a household", async () => {
      const r = await request(parentA, { kind: "new_child", child_name: "Synthetic Kid A", relationship: "parent", details: "Synthetic" });
      expect(r).toEqual({ id: r.id, status: "pending" });
      const decided = await decide(r.id as string, { decision: "approve", verification_method: "in_person", permissions: ALL });
      kidA = decided.child_id as string;
      expect(decided.guardianship_id).toBeTruthy();
      expect((await rpc<Json>(as(housemate), "youth_family")).children).toEqual([]);
      await fails(as(housemate), "youth_family_child", [kidA], /Not found/);
      await fails(as(housemate), "youth_child_events", [kidA], /Not found/);
      const fam = await rpc<Json>(as(parentA), "youth_family");
      expect((fam.children as Json[]).map((c) => c.id)).toEqual([kidA]);
    });

    it("gives requesters the same answer whether or not a child exists, and only their status", async () => {
      const existing = await request(stranger, { kind: "existing_child", child_name: "Synthetic Kid A", relationship: "parent" });
      const nobody = await request(stranger, { kind: "existing_child", child_name: "Nobody Synthetic", relationship: "parent" });
      expect(Object.keys(existing).sort()).toEqual(["id", "status"]);
      expect(existing.status).toBe(nobody.status);
      const mine = await rpc<Json[]>(as(stranger), "youth_my_requests");
      expect(JSON.stringify(mine)).not.toContain(kidA);
      expect(mine.every((m) => !("child_id" in m))).toBe(true);
      // Pending requests open nothing.
      await fails(as(stranger), "youth_family_child", [kidA], /Not found/);
      await rpc(as(stranger), "youth_guardian_request_withdraw", [existing.id]);
      await rpc(as(stranger), "youth_guardian_request_withdraw", [nobody.id]);
    });

    it("never lets anyone verify their own relationship or a non-administrator verify", async () => {
      const r = await request(famAdmin, { kind: "new_child", child_name: "Synthetic Self", relationship: "parent" });
      await fails(as(famAdmin), "youth_admin_request_decide", [r.id, j({ decision: "approve", verification_method: "in_person" })], /Someone else/);
      await fails(as(parentA), "youth_admin_request_decide", [r.id, j({ decision: "approve", verification_method: "in_person" })], /permission/);
      await fails(as(famAdmin2), "youth_admin_request_decide", [r.id, j({ decision: "approve" })], /how the relationship was verified/);
      await decide(r.id as string, { decision: "decline" }, famAdmin2);
    });

    it("enforces one guardian per child unless the policy allows more", async () => {
      const r = await request(parentB, { kind: "existing_child", child_name: "Synthetic Kid A", relationship: "parent" });
      await expect(decide(r.id as string, { decision: "approve", child_id: kidA, verification_method: "known_to_staff", permissions: { register: true } }))
        .rejects.toThrow(/allows one guardian/);
      await approvePolicy({ multiple_guardians: true, birth_date_required: true });
      await decide(r.id as string, { decision: "approve", child_id: kidA, verification_method: "known_to_staff", permissions: { receive_updates: true, view_progress: true } });
      const b = await rpc<Json>(as(parentB), "youth_family_child", [kidA]);
      expect(b.permissions).toMatchObject({ receive_updates: true, register: false, manage_profile: false, sign_forms: false });
      expect(b.other_guardians).toBe(1);
      expect(b.birth_date).toBeNull();
      expect(JSON.stringify(b)).not.toContain("Parent A");
    });

    it("applies permissions per child and per capability", async () => {
      await fails(as(parentB), "youth_child_save", [kidA, j({ display_name: "Renamed" })], /Not found/);
      await rpc(as(parentA), "youth_child_save", [kidA, j({ display_name: "Synthetic Kid A", birth_date: "2014-03-02" })]);
      const a = await rpc<Json>(as(parentA), "youth_family_child", [kidA]);
      expect(a.birth_date).toBe("2014-03-02");
    });

    it("keeps birth dates and values out of logs, history, and notifications", async () => {
      const log = await db.raw("select action, details from public.audit_log where target_type in ('youth_child', 'youth_guardianship', 'youth_request')");
      const fam = await db.raw("select action, fields from youth.family_log");
      const n = await db.raw("select detail from community.notifications where category = 'youth'");
      for (const blob of [log, fam, n].map((x) => JSON.stringify(x))) {
        expect(blob).not.toContain("2014-03-02");
        expect(blob).not.toContain("Synthetic Kid A");
      }
      expect(JSON.stringify(fam)).toContain("birth_date");
    });

    it("pauses every guardian path when restricted or suspended, and revocation is final", async () => {
      await rpc(as(famAdmin), "youth_admin_child_restrict", [kidA, true, "disputed_relationship"]);
      await fails(as(parentA), "youth_family_child", [kidA], /Not found/);
      expect((await rpc<Json>(as(parentA), "youth_family")).paused).toBe(1);
      await rpc(as(famAdmin), "youth_admin_child_restrict", [kidA, false, null]);
      await rpc(as(parentA), "youth_family_child", [kidA]);
      const gB = (await db.raw<{ id: string }>("select id from youth.guardianships where guardian_id = $1", [parentB]))[0].id;
      await rpc(as(famAdmin), "youth_admin_guardian_update", [gB, j({ status: "suspended" })]);
      await fails(as(parentB), "youth_family_child", [kidA], /Not found/);
      await rpc(as(famAdmin), "youth_admin_guardian_update", [gB, j({ status: "verified", verification_method: "known_to_staff" })]);
      await rpc(as(parentB), "youth_family_child", [kidA]);
      await rpc(as(famAdmin), "youth_admin_guardian_update", [gB, j({ status: "revoked" })]);
      await fails(as(parentB), "youth_family_child", [kidA], /Not found/);
      await fails(as(famAdmin), "youth_admin_guardian_update", [gB, j({ status: "verified", verification_method: "in_person" })], /has ended/);
      const history = (await rpc<Json>(as(famAdmin), "youth_admin_child", [kidA])).history as Json[];
      expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["child.restricted", "guardian.suspended", "guardian.revoked"]));
    });
  });

  describe("children never appear in adult paths", () => {
    it("keeps child profiles out of directory, event member search, and DM recipients", async () => {
      expect(await setOf(as(stranger), "directory_search", ["Synthetic Kid", 50, 0])).not.toContain("Kid A");
      expect(JSON.stringify(await rpc(as(admin), "events_admin_member_search", ["Synthetic Kid"]))).not.toContain("Kid A");
      const dm = await rpc<Json>(as(stranger), "community_dm_recipients", ["Synthetic Kid"]);
      expect(JSON.stringify(dm)).not.toContain("Kid A");
      const hh = await rpc<Json>(as(parentA), "my_household");
      expect(JSON.stringify(hh)).not.toContain("Kid A");
    });
  });

  describe("groups and leaders", () => {
    it("assigns leaders who hold the role and protects the last leader", async () => {
      groupA = (await rpc<Json>(as(ministry), "youth_admin_group_save", [null, j({ name: "Synthetic Middle School" })])).id as string;
      groupB = (await rpc<Json>(as(ministry), "youth_admin_group_save", [null, j({ name: "Synthetic High School" })])).id as string;
      await fails(as(ministry), "youth_admin_leader_set", [groupA, stranger, j({ role: "leader" })], /Youth leader role/);
      await rpc(as(ministry), "youth_admin_leader_set", [groupA, leader1, j({ role: "leader", can_publish: true, can_manage_enrollment: true })]);
      await rpc(as(ministry), "youth_admin_leader_set", [groupB, leader3, j({ role: "leader" })]);
      await fails(as(ministry), "youth_admin_leader_set", [groupA, leader1, j({ status: "removed" })], /at least one leader/);
      await rpc(as(ministry), "youth_admin_leader_set", [groupA, leader2, j({ role: "leader" })]);
      await fails(as(leader1), "youth_admin_group_save", [null, j({ name: "Nope" })], /permission/);
    });

    it("lets leaders enroll only in their own group and see only that roster", async () => {
      const k = async (name: string) => (await rpc<Json>(as(famAdmin), "youth_admin_child_save", [null, j({ display_name: name })])).id as string;
      kidB = await k("Synthetic Kid B");
      kidC = await k("Synthetic Kid C");
      kidD = await k("Synthetic Kid D");
      for (const kid of [kidA, kidB, kidC, kidD]) await rpc(as(leader1), "youth_enroll", [groupA, kid]);
      await fails(as(leader3), "youth_enroll", [groupA, kidA], /Not found/);
      await fails(as(leader2), "youth_enroll", [groupA, kidA], /Not found/); // no enrollment permission
      const roster = await rpc<Json>(as(leader1), "youth_group_roster", [groupA]);
      expect((roster.members as Json[]).map((m) => m.display_name)).toEqual(["Synthetic Kid A", "Synthetic Kid B", "Synthetic Kid C", "Synthetic Kid D"]);
      expect(JSON.stringify(roster)).not.toMatch(/2014|birth|email|phone|Parent/);
      await fails(as(leader3), "youth_group_roster", [groupA], /Not found/);
      await fails(as(stranger), "youth_group_roster", [groupA], /Not found/);
      // A guardian links parentA to kidB for later event tests.
      const r = await request(parentA, { kind: "existing_child", child_name: "Synthetic Kid B", relationship: "parent" });
      await decide(r.id as string, { decision: "approve", child_id: kidB, verification_method: "in_person", permissions: ALL });
    });

    it("drops access at once when the leader role is removed", async () => {
      await db.raw("delete from public.user_roles where user_id = $1 and role_key = 'youth_leader'", [leader2]);
      await fails(as(leader2), "youth_group_roster", [groupA], /Not found/);
      await db.grantRole(leader2, "youth_leader");
      await rpc(as(leader2), "youth_group_roster", [groupA]);
    });

    it("does not imply finance, membership, roles, journal, or confidential care access", async () => {
      const caps = (await db.query<{ c: string }>(as(leader1), "select c from public.my_capabilities() c")).map((r) => r.c);
      expect(caps).toEqual(["youth.lead"]);
      await fails(as(leader1), "admin_set_membership_status", [stranger, "suspended"], /permission/);
    });
  });

  describe("youth events and permission forms", () => {
    let form: string;
    let v1: string;
    let ev: { series: string; occ: string };

    it("sets up versioned forms and youth-only events", async () => {
      form = (await rpc<Json>(as(forms), "youth_admin_form_save", [null, j({ title: "Synthetic Trip Permission" })])).id as string;
      v1 = (await rpc<Json>(as(forms), "youth_admin_form_draft", [form, j({ body: "Synthetic form text v1.", statement: "I give permission." })])).id as string;
      await rpc(as(forms), "youth_admin_form_publish", [v1, "publish"]);
      ev = await youthEvent({ capacity: 2, waitlist_enabled: true }, { form_ids: [form], collect_emergency_contact: true, collect_pickup: true });
      // The general event editor can't widen a youth event.
      await fails(as(admin), "events_admin_save", [j({ id: ev.series, audience: "members" })], /Youth administration/);
    });

    it("hides youth events from unrelated adults and refuses adult RSVPs", async () => {
      const vis = async (who: string) => (await db.raw<{ v: boolean }>("select events.visible_to($1, $2) v", [ev.series, who]))[0].v;
      expect(await vis(parentA)).toBe(true);
      expect(await vis(leader1)).toBe(true);
      expect(await vis(stranger)).toBe(false);
      expect(await vis(housemate)).toBe(false);
      expect(await vis(leader3)).toBe(false);
      await fails(as(parentA), "events_rsvp", [ev.occ], /each child/);
      await fails(as(stranger), "events_rsvp", [ev.occ], /wasn't found/);
    });

    it("needs a current consent and emergency contact before registering a child", async () => {
      await fails(as(parentA), "youth_child_register", [ev.occ, kidA], /permission form/);
      await rpc(as(parentA), "youth_consent_submit", [ev.series, kidA, v1, j({ decision: "granted", agree: true })]);
      await fails(as(parentA), "youth_child_register", [ev.occ, kidA], /emergency contact/);
      await rpc(as(parentA), "youth_logistics_save", [ev.series, kidA, j({ emergency_name: "Synthetic Contact", emergency_phone: "555-0100", pickup_note: "Synthetic pickup", accommodation_note: "ignored" })]);
      expect(await rpc<Json>(as(parentA), "youth_child_register", [ev.occ, kidA])).toMatchObject({ status: "confirmed" });
      const mine = await rpc<Json>(as(parentA), "youth_child_event", [ev.occ, kidA]);
      expect(mine.logistics).toMatchObject({ emergency_phone: "555-0100", accommodation_note: null });
    });

    it("never lets a guardian without the permission register or sign", async () => {
      const r = await request(parentB, { kind: "existing_child", child_name: "Synthetic Kid C", relationship: "caregiver" });
      await decide(r.id as string, { decision: "approve", child_id: kidC, verification_method: "in_person", permissions: { receive_updates: true } });
      await fails(as(parentB), "youth_child_register", [ev.occ, kidC], /wasn't found/);
      await fails(as(parentB), "youth_consent_submit", [ev.series, kidC, v1, j({ decision: "granted", agree: true })], /Not found/);
    });

    it("fills capacity in order and waitlists without jumping the queue", async () => {
      // kidB and kidD: parentA guards kidB; family admin links parentA to kidD too.
      const r = await request(parentA, { kind: "existing_child", child_name: "Synthetic Kid D", relationship: "parent" });
      await decide(r.id as string, { decision: "approve", child_id: kidD, verification_method: "in_person", permissions: ALL });
      for (const kid of [kidB, kidD]) {
        await rpc(as(parentA), "youth_consent_submit", [ev.series, kid, v1, j({ decision: "granted", agree: true })]);
        await rpc(as(parentA), "youth_logistics_save", [ev.series, kid, j({ emergency_name: "Synthetic", emergency_phone: "555-0101" })]);
      }
      expect(await rpc<Json>(as(parentA), "youth_child_register", [ev.occ, kidB])).toMatchObject({ status: "confirmed" });
      expect(await rpc<Json>(as(parentA), "youth_child_register", [ev.occ, kidD])).toMatchObject({ status: "waitlisted", position: 1 });
      await rpc(as(parentA), "youth_child_cancel", [ev.occ, kidB]);
      const reg = await db.raw<{ status: string }>("select status from youth.registrations where occurrence_id = $1 and child_id = $2", [ev.occ, kidD]);
      expect(reg[0].status).toBe("confirmed");
      expect((await notices(parentA, "youth_registration")).length).toBeGreaterThan(0);
    });

    it("asks for renewed consent after a material change and keeps it after a wording fix", async () => {
      const v2 = (await rpc<Json>(as(forms), "youth_admin_form_draft", [form, j({ body: "Synthetic v2: new destination.", statement: "I give permission.", material: true })])).id as string;
      const pub = await rpc<Json>(as(forms), "youth_admin_form_publish", [v2, "publish"]);
      expect(pub.renewals_needed).toBe(2);
      const admin1 = await rpc<Json>(as(forms), "youth_event_admin", [ev.series]);
      const att = ((admin1.occurrences as Json[])[0].attendees as Json[]);
      expect(att.every((a) => (a.forms as Json[])[0].state === "renewal_needed")).toBe(true);
      expect((await notices(parentA, "youth_form_needed")).length).toBe(2);
      // Old version is refused; the current one renews.
      await fails(as(parentA), "youth_consent_submit", [ev.series, kidA, v1, j({ decision: "granted", agree: true })], /updated/);
      await rpc(as(parentA), "youth_consent_submit", [ev.series, kidA, v2, j({ decision: "granted", agree: true })]);
      const v3 = (await rpc<Json>(as(forms), "youth_admin_form_draft", [form, j({ body: "Synthetic v2 (typo fixed).", statement: "I give permission.", material: false })])).id as string;
      await rpc(as(forms), "youth_admin_form_publish", [v3, "publish"]);
      const state = await db.raw<{ s: string }>("select youth.consent_state($1, $2, $3) s", [ev.series, kidA, form]);
      expect(state[0].s).toBe("granted");
      const stateD = await db.raw<{ s: string }>("select youth.consent_state($1, $2, $3) s", [ev.series, kidD, form]);
      expect(stateD[0].s).toBe("renewal_needed");
      // The form-needed notice disappears once it no longer applies.
      const visible = await db.raw<{ v: boolean }>(
        "select community.notification_visible(n) v from community.notifications n where n.profile_id = $1 and n.kind = 'youth_form_needed' and n.youth_child_id = $2",
        [parentA, kidA],
      );
      expect(visible.every((r) => r.v === false)).toBe(true);
    });

    it("records withdrawal, cancels the place, and promotes the waitlist", async () => {
      const consent = (await db.raw<{ id: string }>(
        "select id from youth.consents where child_id = $1 and series_id = $2 and withdrawn_at is null order by decided_at desc limit 1",
        [kidA, ev.series],
      ))[0].id;
      await rpc(as(parentA), "youth_consent_withdraw", [consent]);
      const rows = await db.raw<{ status: string; cancel_reason: string }>("select status, cancel_reason from youth.registrations where occurrence_id = $1 and child_id = $2", [ev.occ, kidA]);
      expect(rows[0]).toEqual({ status: "canceled", cancel_reason: "consent_withdrawn" });
      const kept = await db.raw<{ withdrawn_at: Date | null }>("select withdrawn_at from youth.consents where id = $1", [consent]);
      expect(kept[0].withdrawn_at).not.toBeNull();
      const cols = await db.raw<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'youth' and table_name = 'consents'");
      expect(cols.map((c) => c.column_name).filter((c) => /^ip|user_agent|device|fingerprint/.test(c))).toEqual([]);
    });

    it("shows logistics only to designated personnel and logs access without values", async () => {
      await fails(as(leader1), "youth_logistics_list", [ev.series], /Not found/);
      await fails(as(forms), "youth_logistics_list", [ev.series], /Not found/);
      await fails(as(forms), "youth_admin_personnel_set", [ev.series, stranger, true], /personnel must/);
      await rpc(as(forms), "youth_admin_personnel_set", [ev.series, logistics, true]);
      const list = await rpc<Json>(as(logistics), "youth_logistics_list", [ev.series]);
      expect(JSON.stringify(list)).toContain("555-0101");
      const logs = await db.raw("select * from youth.access_log where kind = 'logistics_view'");
      expect(logs).toHaveLength(1);
      const blob = JSON.stringify(await db.raw("select * from public.audit_log")) + JSON.stringify(await db.raw("select * from youth.family_log"))
        + JSON.stringify(await db.raw("select * from community.notifications")) + JSON.stringify(await rpc(as(forms), "youth_event_admin", [ev.series]));
      expect(blob).not.toContain("555-01");
      expect(blob).not.toContain("Synthetic pickup");
      // Calendar output (Phase 4 feed) carries no logistics.
      const feed = JSON.stringify(await db.raw("select * from events.series where id = $1", [ev.series]));
      expect(feed).not.toContain("555-01");
    });
  });

  describe("independent youth accounts", () => {
    let code: string;
    let youthUser: string;

    it("stays disabled until the approved policy allows it", async () => {
      await fails(as(famAdmin), "youth_account_invite", [kidB, "synthetic.youth@example.test"], /aren't available/);
      await approvePolicy({
        multiple_guardians: true, birth_date_required: true, independent_accounts: true, minimum_age_years: 11,
        eligibility_rule: "Synthetic rule supplied by the church.", youth_rsvp: true, youth_discussions: true, discussion_min_leaders: 2,
        guardian_discussion_access: "read", progress_sharing: "youth_choice", adult_transition: true,
      });
    });

    it("fails closed without an eligibility decision or a recorded birth date", async () => {
      await fails(as(parentA), "youth_account_invite", [kidB, "synthetic.youth@example.test"], /eligibility/);
      await rpc(as(famAdmin), "youth_admin_eligibility_set", [kidB, true]);
      await fails(as(parentA), "youth_account_invite", [kidB, "synthetic.youth@example.test"], /can't be confirmed/);
      await rpc(as(parentA), "youth_child_save", [kidB, j({ birth_date: ymd(-365 * 9) })]);
      await fails(as(parentA), "youth_account_invite", [kidB, "synthetic.youth@example.test"], /can't be confirmed/);
      await rpc(as(parentA), "youth_child_save", [kidB, j({ birth_date: ymd(-365 * 13) })]);
      await fails(as(parentA), "youth_account_invite", [kidB, "y.stranger@example.test"], /can't be used/);
      await fails(as(stranger), "youth_account_invite", [kidB, "synthetic.youth@example.test"], /Not found/);
    });

    it("starts guardian-recorded practice for the child (not the guardian)", async () => {
      const learn = await rpc<Json>(as(leader1), "youth_learning_assign", [groupA, j({ kind: "memory_collection", ref_id: collection })]);
      expect(learn.id).toBeTruthy();
      const card = await rpc<Json>(as(parentA), "youth_child_card_add", [kidB, item]);
      const s = await rpc<Json>(as(parentA), "youth_child_session_start", [kidB, card.id, "self_check", "guided", 0]);
      expect(JSON.stringify(s.setup)).not.toContain("loved the world");
      await rpc(as(parentA), "youth_child_session_reveal", [s.id]);
      const res = await rpc<Json>(as(parentA), "youth_child_session_submit", [s.id, j({ confidence: "fully" })]);
      expect(res).toMatchObject({ saved: true, recorded_for: "Synthetic Kid B" });
      const again = await rpc<Json>(as(parentA), "youth_child_session_submit", [s.id, j({ confidence: "fully" })]);
      expect(again.replayed).toBe(true);
      expect((await db.raw("select * from memory.attempts where profile_id = $1", [parentA])).length).toBe(0);
      expect((await db.raw("select * from youth.practice_attempts where child_id = $1", [kidB])).length).toBe(1);
      const progress = await rpc<Json>(as(parentA), "youth_child_progress", [kidB]);
      expect(progress).toMatchObject({ independent: false, verses_practiced: 1 });
      await fails(as(parentB), "youth_child_practice", [kidB], /Not found/);
    });

    it("activates only through a code, a verified matching email, and guardian authorization", async () => {
      const inv = await rpc<Json>(as(famAdmin), "youth_account_invite", [kidB, "Synthetic.Youth@example.test"]);
      code = inv.code as string;
      expect(inv.guardian_authorized).toBe(false);
      // The youth signs up through the normal sign-up (the email is unverified at first).
      youthUser = await db.createAuthUser("synthetic.youth@example.test", { fullName: "Synthetic Youth", verified: false });
      const kind = await db.raw<{ account_kind: string; membership_status: string }>("select account_kind, membership_status from public.profiles where id = $1", [youthUser]);
      expect(kind[0]).toEqual({ account_kind: "youth", membership_status: "pending" });
      // Membership admins can't approve it as an adult account.
      await expect(db.raw("update public.profiles set membership_status = 'approved' where id = $1", [youthUser])).rejects.toThrow(/Youth administration/);
      await fails(as(youthUser), "youth_activate", ["WRONG-CODE"], /didn't work/);
      await fails(as(youthUser), "youth_activate", [code], /Confirm your email/);
      await db.raw("update auth.users set email_confirmed_at = now() where id = $1", [youthUser]);
      await fails(as(youthUser), "youth_activate", [code], /authorize/);
      // An existing adult account can never be converted.
      await fails(as(stranger), "youth_activate", [code], /didn't work/);
      await rpc(as(parentA), "youth_account_authorize", [inv.id]);
      const done = await rpc<Json>(as(youthUser), "youth_activate", [code.toLowerCase()]);
      expect(done).toMatchObject({ status: "active", child_id: kidB, practice_moved: 1 });
      await fails(as(youthUser), "youth_activate", [code], /didn't work/);
      const rec = await db.raw<{ policy_id: string; guardian_authorized_by: string }>("select policy_id, guardian_authorized_by from youth.account_records where child_id = $1", [kidB]);
      expect(rec[0].guardian_authorized_by).toBe(parentA);
      // Progress followed the child into the youth's own history.
      expect((await db.raw("select * from memory.attempts where profile_id = $1", [youthUser])).length).toBe(1);
      expect((await db.raw("select * from youth.practice_attempts where child_id = $1", [kidB])).length).toBe(0);
    });

    it("keeps youth accounts out of every adult feature (fail closed)", async () => {
      const y = as(youthUser);
      const [r] = await db.query<{ a: boolean; c: boolean }>(y, "select public.is_approved_member() a, public.has_capability('members.view') c");
      expect(r).toEqual({ a: false, c: false });
      await expect(setOf(y, "directory_search", ["Synthetic", 10, 0])).rejects.toThrow(/approved|permission/i);
      await fails(y, "community_dm_recipients", ["Synthetic"], /approved members/);
      await fails(y, "community_dm_start", [leader1], /approved members/);
      await fails(as(leader1), "community_dm_start", [youthUser]);
      await fails(as(parentA), "community_dm_start", [youthUser]);
      await fails(y, "prayer_guidance", [], /approved members/);
      await fails(y, "events_rsvp", [randomUUID()], /approved members/);
      expect(await db.query(y, "select * from public.announcements")).toEqual([]);
      // Changing their own birthday or account type does nothing.
      await expect(db.query(y, "update public.profiles set account_kind = 'adult' where id = $1", [youthUser])).rejects.toThrow(/permission denied/);
      await fails(y, "youth_child_save", [kidB, j({ birth_date: "1990-01-01" })], /approved adult/);
      // Absent from directory search and recipient searches.
      expect(await setOf(as(stranger), "directory_search", ["Synthetic Youth", 50, 0])).not.toContain(youthUser);
      expect(JSON.stringify(await rpc(as(admin), "events_admin_member_search", ["Synthetic Youth"]))).not.toContain(youthUser);
      // Roles can't be given to a youth account.
      await expect(db.grantRole(youthUser, "content_editor")).rejects.toThrow(/adult accounts/);
    });

    it("lets the youth learn and keeps their journal private", async () => {
      const y = as(youthUser);
      const home = await rpc<Json>(y, "memory_home");
      expect(home).toBeTruthy();
      const entry = await rpc<Json>(y, "journal_entry_create", [randomUUID(), "Synthetic", "Synthetic private reflection", null]);
      for (const who of [parentA, leader1, famAdmin, admin]) await fails(as(who), "journal_entry", [entry.id], /not found/i);
      const prog = await rpc<Json>(as(parentA), "youth_child_progress", [kidB]);
      expect(prog).toEqual({ independent: true, shared: false });
      await rpc(y, "youth_progress_sharing_set", [true]);
      const shared = await rpc<Json>(as(parentA), "youth_child_progress", [kidB]);
      expect(shared).toMatchObject({ independent: true, shared: true, verses_practiced: 1 });
      expect(JSON.stringify(shared)).not.toMatch(/reflection|your_text|loved the world/);
      const status = await rpc<Json>(y, "youth_account_status");
      expect(status).toMatchObject({ share_summary: true, sharing_mode: "youth_choice", guardian_authorized: true });
    });

    it("lets an eligible youth register only where the policy and event allow it", async () => {
      const open = await youthEvent({ title: "Synthetic Open Night" }, { youth_rsvp: true });
      expect(await rpc<Json>(as(youthUser), "youth_rsvp", [open.occ])).toMatchObject({ status: "confirmed" });
      const withForm = await youthEvent({ title: "Synthetic Form Night" }, { youth_rsvp: true, collect_pickup: true });
      await fails(as(youthUser), "youth_rsvp", [withForm.occ], /parent or guardian/);
      const home = await rpc<Json>(as(youthUser), "youth_home");
      expect((home.events as Json[]).some((e) => e.occurrence_id === withForm.occ && e.needs_guardian === true)).toBe(true);
      expect(JSON.stringify(home)).not.toMatch(/555-01|pickup_note|emergency/);
    });

    it("serves a child's avatar only to people who may see the child", async () => {
      const name = `avatars/${kidA}/${randomUUID()}.webp`;
      await rpc(as(parentA), "youth_child_avatar_set", [kidA, name]);
      const read = async (who: string) => (await db.query<{ ok: boolean }>(as(who), "select public.youth_can_read_object($1) ok", [name]))[0].ok;
      expect(await read(parentA)).toBe(true);
      expect(await read(leader1)).toBe(true);
      expect(await read(stranger)).toBe(false);
      expect(await read(housemate)).toBe(false);
      expect(await read(leader3)).toBe(false);
      const write = async (who: string) => (await db.query<{ ok: boolean }>(as(who), "select public.youth_can_write_object($1) ok", [name]))[0].ok;
      expect(await write(parentA)).toBe(true);
      expect(await write(leader1)).toBe(false);
      await fails(as(parentA), "youth_child_avatar_set", [kidA, `avatars/${kidB}/${randomUUID()}.webp`], /can't be used/);
    });

    it("can't be impersonated by a guardian", async () => {
      await fails(as(parentA), "youth_home", [], /isn't active/);
      await fails(as(parentA), "youth_progress_sharing_set", [false], /isn't active/);
      await fails(as(parentA), "youth_transition_confirm", [randomUUID(), "this is my account"], /isn't active/);
    });
  });

  describe("supervised discussions and reports", () => {
    let disc: string;
    let youthUser: string;

    it("opens only with enough leaders and members, and only leaders start one", async () => {
      youthUser = (await db.raw<{ account_id: string }>("select account_id from youth.children where id = $1", [kidB]))[0].account_id;
      await fails(as(youthUser), "youth_discussion_create", [groupA, j({ title: "T", body: "B" })], /approved adult/);
      await fails(as(leader3), "youth_discussion_create", [groupA, j({ title: "T", body: "B" })], /Only leaders/);
      disc = (await rpc<Json>(as(leader1), "youth_discussion_create", [groupA, j({ title: "Synthetic discussion", body: "Welcome" })])).id as string;
      await fails(as(leader1), "youth_discussion_create", [groupA, j({ title: "P", body: "B", kind: "prayer" })], /Group prayer/);
    });

    it("shows a transparent audience and lets youth reply, guardians read", async () => {
      const d = await rpc<Json>(as(youthUser), "youth_discussion", [disc]);
      expect(d.role).toBe("youth");
      expect(d.audience).toMatchObject({ guardians_can_read: true, leaders: ["Synthetic Leader One", "Synthetic Leader Two"] });
      const key = randomUUID();
      const p1 = await rpc<Json>(as(youthUser), "youth_post", [disc, "Synthetic reply", key]);
      expect((await rpc<Json>(as(youthUser), "youth_post", [disc, "Synthetic reply", key])).replayed).toBe(true);
      expect(p1.id).toBeTruthy();
      const g = await rpc<Json>(as(parentA), "youth_discussion", [disc]);
      expect(g).toMatchObject({ role: "guardian", can_post: false });
      await fails(as(parentA), "youth_post", [disc, "Guardian post", randomUUID()], /Not found/);
      await fails(as(stranger), "youth_discussion", [disc], /Not found/);
      await fails(as(leader3), "youth_discussion", [disc], /Not found/);
    });

    it("stops posting when supervision drops below the policy", async () => {
      await rpc(as(ministry), "youth_admin_leader_set", [groupA, leader2, j({ status: "removed" })]);
      await fails(as(youthUser), "youth_post", [disc, "Too few leaders", randomUUID()], /more leaders/);
      await rpc(as(ministry), "youth_admin_leader_set", [groupA, leader2, j({ role: "leader" })]);
    });

    it("routes reports about a leader outside that leader's scope", async () => {
      const leaderPost = (await db.raw<{ id: string }>("select id from youth.posts where discussion_id = $1 and author_id = $2", [disc, leader1]))[0].id;
      await rpc(as(youthUser), "youth_report", [disc, leaderPost, j({ reason: "private_contact", note: "Synthetic" })]);
      expect(await rpc<Json[]>(as(leader1), "youth_reports", ["open"])).toEqual([]);
      expect(await rpc<Json[]>(as(leader2), "youth_reports", ["open"])).toEqual([]);
      const seen = await rpc<Json[]>(as(safeguard), "youth_reports", ["open"]);
      expect(seen).toHaveLength(1);
      expect(seen[0].about_leader).toBe(true);
      expect(JSON.stringify(seen)).not.toContain(youthUser);
      await rpc(as(safeguard), "youth_report_resolve", [seen[0].id, j({ outcome: "actioned", hide: true })]);
      expect((await db.raw<{ status: string }>("select status from youth.posts where id = $1", [leaderPost]))[0].status).toBe("hidden");
    });

    it("keeps discussions off when the policy turns them off", async () => {
      await approvePolicy({
        multiple_guardians: true, birth_date_required: true, independent_accounts: true, minimum_age_years: 11,
        eligibility_rule: "Synthetic rule supplied by the church.", youth_rsvp: true, youth_discussions: false,
        progress_sharing: "youth_choice", adult_transition: true,
      });
      await fails(as(youthUser), "youth_discussion", [disc], /Not found/);
      await fails(as(parentA), "youth_discussion", [disc], /Not found/);
      await rpc(as(leader1), "youth_discussion", [disc]);
    });
  });

  describe("photo consent", () => {
    let album: string;
    let photo: string;
    let series: string;

    it("blocks publication until consent is confirmed for associated children", async () => {
      series = (await db.raw<{ series_id: string }>("select series_id from youth.event_settings limit 1"))[0].series_id;
      album = (await db.raw<{ id: string }>("insert into media.albums (title, event_series_id, status) values ('Synthetic album', $1, 'published') returning id", [series]))[0].id;
      photo = (await db.raw<{ id: string }>(
        "insert into media.photos (album_id, status, client_key, permission_confirmed) values ($1, 'pending', gen_random_uuid(), true) returning id",
        [album],
      ))[0].id;
      const approve = (minors: string) =>
        db.raw("update media.photos set status = 'approved', minors = $2, display_path = 'gallery/x/' || id || '.webp', thumb_path = 'gallery/x/' || id || 't.webp' where id = $1", [photo, minors]);
      await expect(approve("permission_confirmed")).rejects.toThrow(/Associate this photo/);
      await rpc(as(reviewer), "youth_admin_photo_subject_set", [photo, kidD, true]);
      await expect(approve("permission_confirmed")).rejects.toThrow(/photo consent/);
      await fails(as(parentA), "youth_media_consent_set", [kidD, j({ scope: "public_use", decision: "granted" })], /isn't offered/);
      await rpc(as(parentA), "youth_media_consent_set", [kidD, j({ scope: "member_gallery", decision: "granted" })]);
      await approve("permission_confirmed");
      const pub = await db.raw<{ s: string }>("select youth.media_state($1, 'public_use', null) s", [kidD]);
      expect(pub[0].s).toBe("unknown");
    });

    it("hides and queues the photo when consent is withdrawn or conflicts", async () => {
      const id = (await db.raw<{ id: string }>("select id from youth.media_consents where child_id = $1 and withdrawn_at is null", [kidD]))[0].id;
      await rpc(as(parentA), "youth_media_consent_withdraw", [id]);
      expect((await db.raw<{ status: string }>("select status from media.photos where id = $1", [photo]))[0].status).toBe("hidden");
      const q = await rpc<Json>(as(reviewer), "youth_admin_media_queue");
      expect((q.reviews as Json[])[0]).toMatchObject({ reason: "consent_withdrawn" });
      // The gallery moderator can't simply unhide it.
      await fails(as(reviewer), "media_admin_photo_review", [photo, "unhide", null, null, null, null], /consent/);
      await fails(as(reviewer), "youth_admin_photo_review_resolve", [(q.reviews as Json[])[0].id, "restored"], /isn't confirmed/);
      // A second guardian disagreeing is a conflict, which also blocks.
      await rpc(as(parentA), "youth_media_consent_set", [kidD, j({ scope: "member_gallery", decision: "granted" })]);
      const r = await request(parentB, { kind: "existing_child", child_name: "Synthetic Kid D", relationship: "caregiver" });
      await decide(r.id as string, { decision: "approve", child_id: kidD, verification_method: "in_person", permissions: { media_consent: true } });
      await rpc(as(parentB), "youth_media_consent_set", [kidD, j({ scope: "member_gallery", decision: "declined" })]);
      const st = await db.raw<{ s: string }>("select youth.media_state($1, 'member_gallery', $2) s", [kidD, series]);
      expect(st[0].s).toBe("conflict");
      expect(await rpc<Json>(as(reviewer), "youth_admin_photo", [photo])).toMatchObject({ problem: "conflict" });
      await rpc(as(reviewer), "youth_admin_media_reuse", [photo, j({ kind: "public_reuse", location: "Synthetic newsletter PDF" })]);
      expect(((await rpc<Json>(as(reviewer), "youth_admin_photo", [photo])).reuse as Json[])).toHaveLength(1);
    });
  });

  describe("adult transition and access changes", () => {
    let youthUser: string;

    it("requires the policy, the youth's confirmation, and a second person", async () => {
      youthUser = (await db.raw<{ account_id: string }>("select account_id from youth.children where id = $1", [kidB]))[0].account_id;
      await fails(as(famAdmin), "youth_admin_transition_start", [kidB, j({ eligibility_confirmed: true })], /Confirm eligibility/);
      const t = await rpc<Json>(as(famAdmin), "youth_admin_transition_start", [kidB, j({ eligibility_confirmed: true, identity_confirmed: true })]);
      await fails(as(famAdmin), "youth_admin_transition_complete", [t.id, "complete transition"], /must confirm/);
      await fails(as(youthUser), "youth_transition_confirm", [t.id, "yes"], /this is my account/);
      await rpc(as(youthUser), "youth_transition_confirm", [t.id, "this is my account"]);
      // The administrator who started it can't also complete it.
      await fails(as(famAdmin), "youth_admin_transition_complete", [t.id, "complete transition"], /different family administrator/);
      await rpc(as(famAdmin2), "youth_admin_transition_complete", [t.id, "complete transition"]);
      const p = await db.raw<{ account_kind: string; membership_status: string }>("select account_kind, membership_status from public.profiles where id = $1", [youthUser]);
      expect(p[0]).toEqual({ account_kind: "adult", membership_status: "approved" });
      // Guardians no longer see the person; learning history stays; no DM eligibility granted.
      await fails(as(parentA), "youth_family_child", [kidB], /Not found/);
      expect((await db.raw("select * from memory.attempts where profile_id = $1", [youthUser])).length).toBe(1);
      expect((await db.raw("select * from community.dm_eligibility where profile_id = $1", [youthUser])).length).toBe(0);
      await fails(as(youthUser), "community_dm_start", [stranger], /eligib|messag/i);
      expect((await db.raw<{ listed: boolean }>("select directory_listed listed from public.member_profile_details where profile_id = $1", [youthUser]))[0].listed).toBe(false);
    });

    it("cancels upcoming places when a child leaves a group and drops stale notices", async () => {
      const { occ } = await youthEvent({ title: "Synthetic Second Night" });
      await rpc(as(parentA), "youth_child_register", [occ, kidD]);
      await rpc(as(parentA), "youth_unenroll", [groupA, kidD]);
      const r = await db.raw<{ status: string; cancel_reason: string }>("select status, cancel_reason from youth.registrations where occurrence_id = $1 and child_id = $2", [occ, kidD]);
      expect(r[0]).toEqual({ status: "canceled", cancel_reason: "ineligible" });
      await fails(as(parentA), "youth_child_event", [occ, kidD], /Not found/);
    });

    it("removes a suspended guardian's reach and unread notices", async () => {
      await db.raw("insert into community.notifications (profile_id, kind, category, youth_child_id) values ($1, 'youth_consent_changed', 'youth', $2)", [parentB, kidA]);
      await db.setStatus(parentB, "suspended");
      await fails(as(parentB), "youth_family", [], /approved adult/);
      const left = await db.raw("select * from community.notifications where profile_id = $1 and category = 'youth' and read_at is null", [parentB]);
      expect(left).toEqual([]);
      // Their consent no longer counts.
      const st = await db.raw<{ s: string }>("select youth.media_state($1, 'member_gallery', null) s", [kidD]);
      expect(st[0].s).toBe("granted");
      await db.setStatus(parentB, "approved");
    });

    it("leaves the child guardian-managed when a youth account is deleted", async () => {
      const r = await request(parentA, { kind: "existing_child", child_name: "Synthetic Kid C", relationship: "parent" });
      await decide(r.id as string, { decision: "approve", child_id: kidC, verification_method: "in_person", permissions: ALL });
      await rpc(as(famAdmin), "youth_admin_eligibility_set", [kidC, true]);
      await rpc(as(parentA), "youth_child_save", [kidC, j({ birth_date: ymd(-365 * 14) })]);
      const inv = await rpc<Json>(as(parentA), "youth_account_invite", [kidC, "synthetic.youth2@example.test"]);
      const u = await db.createAuthUser("synthetic.youth2@example.test", { fullName: "Synthetic Youth Two" });
      await rpc(as(u), "youth_activate", [inv.code]);
      // Youth suspension ends youth access at once.
      await db.setStatus(u, "suspended");
      await fails(as(u), "youth_home", [], /isn't active/);
      await fails(as(u), "memory_home", [], /approved members/);
      await db.raw("delete from auth.users where id = $1", [u]);
      const c = await db.raw<{ account_id: string | null; status: string }>("select account_id, status from youth.children where id = $1", [kidC]);
      expect(c[0]).toEqual({ account_id: null, status: "active" });
      const rec = await db.raw<{ ended_reason: string }>("select ended_reason from youth.account_records where child_id = $1", [kidC]);
      expect(rec[0].ended_reason).toBe("account_deleted");
      await rpc(as(parentA), "youth_family_child", [kidC]);
    });
  });

  describe("notifications and announcements", () => {
    it("sends generic email text and rechecks the recipient", async () => {
      const a = await rpc<Json>(as(leader1), "youth_announcement_save", [null, j({ group_id: groupA, title: "Synthetic Camp Update", body: "Synthetic", to_youth: true, to_guardians: true })]);
      await fails(as(leader3), "youth_announcement_publish", [a.id, null], /Not found/);
      await rpc(as(leader1), "youth_announcement_publish", [a.id, null]);
      const n = (await notices(parentA, "youth_announcement"))[0];
      expect(n).toBeTruthy();
      const email = await db.raw<{ e: Json }>("select community.notification_email_item(n) e from community.notifications n where id = $1", [n.id]);
      expect(email[0].e.title).toBe("There's an update in Youth & Families");
      expect(JSON.stringify(email[0].e)).not.toMatch(/Camp|Kid|Middle School/);
      expect((await notices(housemate, "youth_announcement")).length).toBe(0);
      expect((await notices(stranger, "youth_announcement")).length).toBe(0);
      const list = await rpc<Json[]>(as(parentA), "youth_announcements", [null]);
      expect(list.map((x) => x.title)).toContain("Synthetic Camp Update");
      await fails(as(stranger), "youth_group", [groupA], /Not found/);
    });

    it("sends one event reminder per child even when the scheduler overlaps", async () => {
      const { occ } = await youthEvent({ title: "Synthetic Tomorrow", start_date: ymd(0), start_time: "23:30" });
      await db.raw("update events.occurrences set starts_at = now() + interval '3 hours', ends_at = now() + interval '5 hours' where id = $1", [occ]);
      await rpc(as(parentA), "youth_child_register", [occ, kidA]);
      await db.raw("select youth.tick()");
      await db.raw("select youth.tick()");
      expect(await db.raw("select * from youth.reminders_sent where occurrence_id = $1", [occ])).toHaveLength(1);
      const reminders = await db.raw<{ id: string }>(
        "select id from community.notifications where profile_id = $1 and kind = 'youth_event_reminder' and occurrence_id = $2", [parentA, occ]);
      expect(reminders).toHaveLength(1);
      const push = await db.raw<{ body: string }>("select community.op_push_claim('{}'::jsonb) body");
      expect(JSON.stringify(push)).not.toMatch(/Kid|Synthetic Tomorrow/);
      // Canceling the place makes the reminder disappear from the app.
      await rpc(as(parentA), "youth_child_cancel", [occ, kidA]);
      const vis = await db.raw<{ v: boolean }>("select community.notification_visible(n) v from community.notifications n where id = $1", [reminders[0].id]);
      expect(vis[0].v).toBe(false);
    });

    it("rate-limits guardian requests", async () => {
      for (let i = 0; i < 5; i++) {
        await request(housemate, { kind: "new_child", child_name: `Synthetic R${i}`, relationship: "parent" }).catch(() => undefined);
      }
      await expect(request(housemate, { kind: "new_child", child_name: "Synthetic R6", relationship: "parent" })).rejects.toThrow(/too often/);
    });
  });
});
