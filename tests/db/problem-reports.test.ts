import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, type Actor } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * "Report a problem" (20261030000100): who may send and read reports, what
 * is stored, and the rate limit. Every person and report here is synthetic.
 */
type Row = Record<string, unknown>;

describeDb("problem reports: submission, privacy, and administration", () => {
  let db: TestDb;
  let admin: string;
  let moderator: string;
  let member: string;
  let quiet: string;
  let pending: string;
  let suspended: string;

  const submit = (actor: Actor, args: unknown[]) =>
    db.query<{ id: string }>(actor, "select public.problem_report_submit($1, $2, $3, $4) as id", args).then((r) => r[0].id);
  const list = (actor: Actor, status: string | null = "new") =>
    db.query<Row>(actor, "select * from public.admin_problem_reports($1, 100)", [status]);

  beforeAll(async () => {
    db = await TestDb.create();
    admin = await db.createAuthUser("report.admin@example.test", { fullName: "Report Admin" });
    moderator = await db.createAuthUser("report.moderator@example.test", { fullName: "Report Moderator" });
    member = await db.createAuthUser("report.member@example.test", { fullName: "Report Member" });
    quiet = await db.createAuthUser("report.quiet@example.test", { fullName: "Report Quiet" });
    pending = await db.createAuthUser("report.pending@example.test", { fullName: "Report Pending" });
    suspended = await db.createAuthUser("report.suspended@example.test", { fullName: "Report Suspended" });
    for (const id of [admin, moderator, member, quiet, suspended]) await db.setStatus(id, "approved");
    await db.setStatus(suspended, "suspended");
    await db.grantRole(admin, "super_admin");
    await db.grantRole(moderator, "community_moderator");
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("accepts a report from an approved member and stores only the plain path", async () => {
    const id = await submit(as(member), ["navigation", "  The More menu would not close on my phone.  ", "/music?token=secret#frag", true]);
    const [row] = await db.raw<Row>("select reporter_id, category, description, page_path, contact_ok, status from public.problem_reports where id = $1", [id]);
    expect(row).toEqual({
      reporter_id: member,
      category: "navigation",
      description: "The More menu would not close on my phone.",
      page_path: "/music",
      contact_ok: true,
      status: "new",
    });
  });

  it("drops a path that isn't a plain app path", async () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "/a b", "/<script>", "/x".repeat(150)]) {
      const id = await submit(as(quiet), ["other", "Synthetic report with a strange path.", bad, false]);
      const [row] = await db.raw<{ page_path: string | null }>("select page_path from public.problem_reports where id = $1", [id]);
      expect(row.page_path).toBeNull();
    }
  });

  it("refuses visitors, pending and suspended accounts, and invalid input", async () => {
    await expect(submit(anon, ["other", "Synthetic visitor report.", null, false])).rejects.toThrow(/permission denied/);
    await expect(submit(as(pending), ["other", "Synthetic pending report.", null, false])).rejects.toThrow(/approved members/);
    await expect(submit(as(suspended), ["other", "Synthetic suspended report.", null, false])).rejects.toThrow(/approved members/);
    await expect(submit(as(member), ["billing", "Synthetic report, wrong category.", null, false])).rejects.toThrow(/Choose what/);
    await expect(submit(as(member), ["other", "too short", null, false])).rejects.toThrow(/at least 10/);
    await expect(submit(as(member), ["other", "x".repeat(2001), null, false])).rejects.toThrow(/2,000/);
  });

  it("gives members no direct table access", async () => {
    await expect(db.query(as(member), "select * from public.problem_reports")).rejects.toThrow(/permission denied/);
    await expect(db.query(as(admin), "select * from public.problem_reports")).rejects.toThrow(/permission denied/);
    await expect(
      db.query(as(member), "insert into public.problem_reports (category, description) values ('other', 'Synthetic direct insert.')"),
    ).rejects.toThrow(/permission denied/);
  });

  it("shows reports only to super administrators, with email only when contact is allowed", async () => {
    await expect(list(as(member))).rejects.toThrow(/super administrators/);
    await expect(list(as(moderator))).rejects.toThrow(/super administrators/);
    await expect(list(anon)).rejects.toThrow(/permission denied/);
    const rows = await list(as(admin));
    const fromMember = rows.find((r) => r.reporter_name === "Report Member")!;
    expect(fromMember.reporter_email).toBe("report.member@example.test");
    const fromQuiet = rows.filter((r) => r.reporter_name === "Report Quiet");
    expect(fromQuiet.length).toBeGreaterThan(0);
    for (const r of fromQuiet) expect(r.reporter_email).toBeNull();
  });

  it("lets only super administrators resolve and reopen a report", async () => {
    const id = await submit(as(member), ["content", "Synthetic report to resolve.", "/events", false]);
    const setStatus = (actor: Actor, status: string) =>
      db.query(actor, "select public.admin_problem_report_set_status($1, $2)", [id, status]);
    await expect(setStatus(as(member), "resolved")).rejects.toThrow(/super administrators/);
    await expect(setStatus(as(moderator), "resolved")).rejects.toThrow(/super administrators/);
    await setStatus(as(admin), "resolved");
    expect((await list(as(admin), "resolved")).map((r) => r.id)).toContain(id);
    expect((await list(as(admin), "new")).map((r) => r.id)).not.toContain(id);
    const [row] = await db.raw<Row>("select resolved_by, resolved_at is not null as done from public.problem_reports where id = $1", [id]);
    expect(row).toEqual({ resolved_by: admin, done: true });
    await setStatus(as(admin), "new");
    const [reopened] = await db.raw<Row>("select status, resolved_by, resolved_at from public.problem_reports where id = $1", [id]);
    expect(reopened).toEqual({ status: "new", resolved_by: null, resolved_at: null });
    await expect(setStatus(as(admin), "deleted")).rejects.toThrow(/isn't available/);
  });

  it("limits each member to five reports an hour", async () => {
    const limited = await db.createAuthUser("report.limited@example.test", { fullName: "Report Limited" });
    await db.setStatus(limited, "approved");
    for (let i = 0; i < 5; i++) await submit(as(limited), ["other", `Synthetic rate-limit report ${i}.`, null, false]);
    await expect(submit(as(limited), ["other", "Synthetic rate-limit report 6.", null, false])).rejects.toThrow(/too often/);
  });
});
