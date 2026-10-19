import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as, service } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb("database authorization (RLS, grants, privileged functions)", () => {
  let db: TestDb;
  let superAdmin: string;
  let memberAdmin: string;
  let editor: string;
  let member: string;
  let pending: string;
  let suspended: string;

  beforeAll(async () => {
    db = await TestDb.create();
    superAdmin = await db.createAuthUser("super@example.test", { fullName: "Synthetic Super" });
    await db.query(service, "select public.bootstrap_super_admin($1)", ["SUPER@example.test"]);

    memberAdmin = await db.createAuthUser("membership@example.test");
    editor = await db.createAuthUser("editor@example.test");
    member = await db.createAuthUser("member@example.test");
    pending = await db.createAuthUser("pending@example.test");
    suspended = await db.createAuthUser("suspended@example.test");
    for (const id of [memberAdmin, editor, member, suspended]) await db.setStatus(id, "approved");
    await db.grantRole(memberAdmin, "membership_admin");
    await db.grantRole(editor, "content_editor");
    await db.setStatus(suspended, "suspended");
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("registration", () => {
    it("creates a pending profile automatically with the supplied name", async () => {
      const id = await db.createAuthUser("new@example.test", { fullName: "  New Person  " });
      const [profile] = await db.query(as(id), "select email, full_name, membership_status from public.profiles where id = $1", [id]);
      expect(profile).toEqual({ email: "new@example.test", full_name: "New Person", membership_status: "pending" });
    });

    it("ignores forged role or status metadata supplied at sign-up", async () => {
      const id = await db.createAuthUser("forger@example.test", {
        metadata: { membership_status: "approved", role: "super_admin", roles: ["super_admin"] },
      });
      const [profile] = await db.raw("select membership_status from public.profiles where id = $1", [id]);
      expect(profile.membership_status).toBe("pending");
      expect(await db.raw("select * from public.user_roles where user_id = $1", [id])).toHaveLength(0);
    });

    it("keeps the profile email in sync with the auth email", async () => {
      const id = await db.createAuthUser("before@example.test");
      await db.raw("update auth.users set email = 'after@example.test' where id = $1", [id]);
      const [p] = await db.raw("select email from public.profiles where id = $1", [id]);
      expect(p.email).toBe("after@example.test");
    });
  });

  describe("self-service limits and role escalation", () => {
    it("lets a member edit their own basic fields", async () => {
      await db.query(as(member), "update public.profiles set full_name = 'Synthetic Member', phone = '555-0100' where id = $1", [member]);
      const [p] = await db.raw("select full_name, phone from public.profiles where id = $1", [member]);
      expect(p).toEqual({ full_name: "Synthetic Member", phone: "555-0100" });
    });

    it("blocks members from changing their own membership status", async () => {
      await expect(
        db.query(as(pending), "update public.profiles set membership_status = 'approved' where id = $1", [pending]),
      ).rejects.toThrow(/permission denied/);
    });

    it("blocks members from editing their email or someone else's profile", async () => {
      await expect(
        db.query(as(member), "update public.profiles set email = 'x@example.test' where id = $1", [member]),
      ).rejects.toThrow(/permission denied/);
      const rows = await db.query(as(member), "update public.profiles set full_name = 'Hacked' where id = $1 returning id", [pending]);
      expect(rows).toHaveLength(0);
    });

    it("blocks direct inserts into user_roles", async () => {
      await expect(
        db.query(as(member), "insert into public.user_roles (user_id, role_key) values ($1, 'super_admin')", [member]),
      ).rejects.toThrow(/permission denied/);
    });

    it("blocks non-super-admins from granting roles, including membership admins", async () => {
      await expect(db.query(as(member), "select public.admin_grant_role($1, 'super_admin')", [member])).rejects.toThrow(
        /permission to assign roles/,
      );
      await expect(
        db.query(as(memberAdmin), "select public.admin_grant_role($1, 'super_admin')", [memberAdmin]),
      ).rejects.toThrow(/permission to assign roles/);
      await expect(db.query(as(editor), "select public.admin_grant_role($1, 'membership_admin')", [editor])).rejects.toThrow(
        /permission to assign roles/,
      );
    });

    it("refuses to assign roles reserved for later phases", async () => {
      await expect(db.query(as(superAdmin), "select public.admin_grant_role($1, 'group_leader')", [member])).rejects.toThrow(
        /cannot be assigned/,
      );
    });

    it("refuses to assign roles to members who are not approved", async () => {
      await expect(db.query(as(superAdmin), "select public.admin_grant_role($1, 'content_editor')", [pending])).rejects.toThrow(
        /approved members/,
      );
    });

    it("hides privileged functions and system state from clients", async () => {
      await expect(db.query(as(member), "select public.bootstrap_super_admin('member@example.test')")).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query(anon, "select public.bootstrap_super_admin('member@example.test')")).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query(as(superAdmin), "select * from public.system_state")).rejects.toThrow(/permission denied/);
    });
  });

  describe("capabilities", () => {
    const caps = async (id: string) =>
      (await db.query<{ c: string }>(as(id), "select c from public.my_capabilities() c")).map((r) => r.c);

    it("gives super admins every available capability", async () => {
      expect(await caps(superAdmin)).toEqual([
        "announcements.manage",
        "audit.view",
        "community.manage",
        "community.moderate",
        "events.manage",
        "members.manage",
        "members.view",
        "roles.manage",
        "settings.manage",
      ]);
    });

    it("keeps content editing separate from membership and finance", async () => {
      expect(await caps(editor)).toEqual(["announcements.manage"]);
      const [r] = await db.query(as(editor), "select public.has_capability('finance.manage') f, public.has_capability('members.manage') m");
      expect(r).toEqual({ f: false, m: false });
    });

    it("gives membership admins only membership capabilities", async () => {
      expect(await caps(memberAdmin)).toEqual(["members.manage", "members.view"]);
    });

    it("grants nothing to pending, suspended, or plain members", async () => {
      expect(await caps(member)).toEqual([]);
      expect(await caps(pending)).toEqual([]);
      await db.grantRole(suspended, "content_editor");
      expect(await caps(suspended)).toEqual([]);
    });
  });

  describe("member approval and suspension", () => {
    it("lets a membership admin approve, suspend, and reinstate with an audit trail", async () => {
      const id = await db.createAuthUser("applicant@example.test");
      await db.query(as(memberAdmin), "select public.admin_set_membership_status($1, 'approved')", [id]);
      await db.query(as(memberAdmin), "select public.admin_set_membership_status($1, 'suspended')", [id]);
      await db.query(as(memberAdmin), "select public.admin_set_membership_status($1, 'approved')", [id]);
      const [p] = await db.raw("select membership_status, status_changed_by from public.profiles where id = $1", [id]);
      expect(p).toEqual({ membership_status: "approved", status_changed_by: memberAdmin });
      const audit = await db.query(as(superAdmin), "select action, details from public.audit_log where target_id = $1 order by id", [id]);
      expect(audit.map((a) => a.details)).toEqual([
        { from: "pending", to: "approved" },
        { from: "approved", to: "suspended" },
        { from: "suspended", to: "approved" },
      ]);
    });

    it("denies status changes to editors, members, and the target themselves", async () => {
      await expect(db.query(as(editor), "select public.admin_set_membership_status($1, 'approved')", [pending])).rejects.toThrow(
        /permission/,
      );
      await expect(db.query(as(memberAdmin), "select public.admin_set_membership_status($1, 'suspended')", [memberAdmin])).rejects.toThrow(
        /your own/,
      );
    });

    it("does not let membership admins suspend a super admin", async () => {
      await expect(
        db.query(as(memberAdmin), "select public.admin_set_membership_status($1, 'suspended')", [superAdmin]),
      ).rejects.toThrow(/Only a super administrator/);
    });

    it("hides the member list from members without members.view", async () => {
      const visible = await db.query(as(member), "select id from public.profiles");
      expect(visible.map((r) => r.id)).toEqual([member]);
      const forAdmin = await db.query(as(memberAdmin), "select id from public.profiles");
      expect(forAdmin.length).toBeGreaterThan(5);
    });

    it("stops a suspended admin from using their capabilities", async () => {
      const id = await db.createAuthUser("former-admin@example.test");
      await db.setStatus(id, "approved");
      await db.grantRole(id, "membership_admin");
      await db.query(as(superAdmin), "select public.admin_set_membership_status($1, 'suspended')", [id]);
      await expect(db.query(as(id), "select public.admin_set_membership_status($1, 'approved')", [pending])).rejects.toThrow(
        /permission/,
      );
    });
  });

  describe("super administrator safeguards", () => {
    it("allows the bootstrap exactly once", async () => {
      await expect(db.query(service, "select public.bootstrap_super_admin('member@example.test')")).rejects.toThrow(
        /already been appointed/,
      );
    });

    it("prevents removing or suspending the last active super admin", async () => {
      await expect(db.query(as(superAdmin), "select public.admin_revoke_role($1, 'super_admin')", [superAdmin])).rejects.toThrow(
        /last active super administrator/,
      );
      await expect(db.raw("update public.profiles set membership_status = 'suspended' where id = $1", [superAdmin])).rejects.toThrow(
        /last active super administrator/,
      );
      await expect(db.raw("delete from auth.users where id = $1", [superAdmin])).rejects.toThrow(/last active super administrator/);
    });

    it("allows handing over once a second super admin exists", async () => {
      const second = await db.createAuthUser("second-super@example.test");
      await db.setStatus(second, "approved");
      await db.query(as(superAdmin), "select public.admin_grant_role($1, 'super_admin')", [second]);
      await db.query(as(second), "select public.admin_revoke_role($1, 'super_admin')", [superAdmin]);
      expect(await db.raw("select 1 from public.user_roles where user_id = $1 and role_key = 'super_admin'", [superAdmin])).toHaveLength(0);
      // Restore for the remaining tests, then make sure the second one is now protected again.
      await db.query(as(second), "select public.admin_grant_role($1, 'super_admin')", [superAdmin]);
      await db.query(as(superAdmin), "select public.admin_revoke_role($1, 'super_admin')", [second]);
      await expect(db.query(as(superAdmin), "select public.admin_revoke_role($1, 'super_admin')", [superAdmin])).rejects.toThrow(
        /last active super administrator/,
      );
    });

    it("bootstrap requires a verified email address", async () => {
      const fresh = await TestDb.create();
      try {
        await fresh.createAuthUser("unverified@example.test", { verified: false });
        await expect(fresh.query(service, "select public.bootstrap_super_admin('unverified@example.test')")).rejects.toThrow(
          /No verified account/,
        );
      } finally {
        await fresh.destroy();
      }
    }, 60_000);
  });

  describe("church settings", () => {
    it("is publicly readable with a default name and empty contact details", async () => {
      const [s] = await db.query(anon, "select church_name, contact_email, timezone, gathering_times from public.church_settings");
      expect(s).toEqual({ church_name: "The Gathering", contact_email: null, timezone: "America/Chicago", gathering_times: [] });
    });

    it("persists updates by a settings manager and audits field names only", async () => {
      await db.query(as(superAdmin), "update public.church_settings set contact_email = 'office@example.test', timezone = 'America/New_York'");
      const [s] = await db.query(anon, "select contact_email, timezone, updated_by from public.church_settings");
      expect(s).toEqual({ contact_email: "office@example.test", timezone: "America/New_York", updated_by: superAdmin });
      const [audit] = await db.query(as(superAdmin), "select details from public.audit_log where action = 'settings.updated' order by id desc limit 1");
      expect(audit.details).toEqual({ fields: ["contact_email", "timezone"] });
      await db.query(as(superAdmin), "update public.church_settings set timezone = 'America/Chicago'");
    });

    it("rejects invalid time zones", async () => {
      await expect(db.query(as(superAdmin), "update public.church_settings set timezone = 'Mars/Olympus'")).rejects.toThrow(
        /time zone/,
      );
    });

    it("ignores updates from members, editors, and membership admins", async () => {
      for (const id of [member, editor, memberAdmin]) {
        const rows = await db.query(as(id), "update public.church_settings set church_name = 'Hijacked' returning id");
        expect(rows).toHaveLength(0);
      }
      await expect(db.query(anon, "update public.church_settings set church_name = 'Hijacked'")).rejects.toThrow(/permission denied/);
      const [s] = await db.raw("select church_name from public.church_settings");
      expect(s.church_name).toBe("The Gathering");
    });
  });

  describe("announcements", () => {
    const create = async (fields: Record<string, unknown>) => {
      const cols = Object.keys(fields);
      const rows = await db.query<{ id: string }>(
        as(editor),
        `insert into public.announcements (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(fields),
      );
      return rows[0].id;
    };
    const visibleTo = async (actor: Parameters<TestDb["query"]>[0]) =>
      (await db.query<{ title: string }>(actor, "select title from public.announcements order by title")).map((r) => r.title);

    let ids: Record<string, string>;
    beforeAll(async () => {
      const hour = 3600_000;
      const now = Date.now();
      ids = {
        draft: await create({ title: "A draft", visibility: "public" }),
        publicLive: await create({ title: "B public live", status: "published", visibility: "public" }),
        membersLive: await create({ title: "C members live", status: "published", visibility: "members" }),
        scheduledFuture: await create({ title: "D scheduled future", status: "scheduled", visibility: "public", publish_at: new Date(now + hour) }),
        scheduledPast: await create({ title: "E scheduled due", status: "scheduled", visibility: "public", publish_at: new Date(now - hour) }),
        expired: await create({
          title: "F expired",
          status: "published",
          visibility: "public",
          publish_at: new Date(now - 2 * hour),
          expires_at: new Date(now - hour),
        }),
        archived: await create({ title: "G archived", status: "published", visibility: "public" }),
      };
      await db.query(as(editor), "update public.announcements set status = 'archived' where id = $1", [ids.archived]);
    });

    it("shows anonymous visitors only live public announcements", async () => {
      expect(await visibleTo(anon)).toEqual(["B public live", "E scheduled due"]);
    });

    it("shows pending and suspended accounts only public announcements", async () => {
      expect(await visibleTo(as(pending))).toEqual(["B public live", "E scheduled due"]);
      expect(await visibleTo(as(suspended))).toEqual(["B public live", "E scheduled due"]);
    });

    it("shows approved members live public and members-only announcements", async () => {
      expect(await visibleTo(as(member))).toEqual(["B public live", "C members live", "E scheduled due"]);
    });

    it("shows announcement managers everything, including drafts and archives", async () => {
      expect(await visibleTo(as(editor))).toHaveLength(7);
    });

    it("makes a scheduled announcement visible once its time arrives, with no job", async () => {
      await db.raw("update public.announcements set publish_at = now() - interval '1 second' where id = $1", [ids.scheduledFuture]);
      expect(await visibleTo(anon)).toContain("D scheduled future");
    });

    it("blocks members from creating or editing announcements", async () => {
      await expect(db.query(as(member), "insert into public.announcements (title) values ('x')")).rejects.toThrow(/row-level security/);
      const rows = await db.query(as(member), "update public.announcements set title = 'x' where id = $1 returning id", [ids.publicLive]);
      expect(rows).toHaveLength(0);
      await expect(db.query(as(editor), "delete from public.announcements where id = $1", [ids.draft])).rejects.toThrow(/permission denied/);
    });

    it("prevents forging authorship", async () => {
      const id = await create({ title: "H authorship" });
      await expect(
        db.query(as(editor), "update public.announcements set created_by = $2 where id = $1", [id, superAdmin]),
      ).rejects.toThrow(/permission denied/);
      const [a] = await db.raw("select created_by, updated_by from public.announcements where id = $1", [id]);
      expect(a).toEqual({ created_by: editor, updated_by: editor });
    });

    it("validates schedule and image rules", async () => {
      await expect(create({ title: "bad", status: "scheduled" })).rejects.toThrow(/publish_at_required/);
      await expect(
        create({ title: "bad", status: "published", publish_at: new Date(), expires_at: new Date(Date.now() - 1000) }),
      ).rejects.toThrow(/expiry_after_publish/);
      await expect(create({ title: "bad", image_path: "x.png" })).rejects.toThrow(/image_alt_required/);
    });

    it("audits announcement changes without recording content", async () => {
      const rows = await db.query(as(superAdmin), "select action, details from public.audit_log where target_id = $1 order by id", [ids.archived]);
      expect(rows.map((r) => r.action)).toEqual(["announcement.created", "announcement.status_changed"]);
      expect(JSON.stringify(rows)).not.toContain("G archived");
    });
  });

  describe("storage", () => {
    it("ties announcement image access to announcement visibility", async () => {
      await db.raw(
        `insert into storage.objects (bucket_id, name) values
           ('announcement-images', 'public.png'), ('announcement-images', 'members.png'), ('announcement-images', 'orphan.png')`,
      );
      await db.query(
        as(editor),
        "insert into public.announcements (title, status, visibility, image_path, image_alt) values ('img pub', 'published', 'public', 'public.png', 'alt'), ('img mem', 'published', 'members', 'members.png', 'alt')",
      );
      const names = async (actor: Parameters<TestDb["query"]>[0]) =>
        (await db.query<{ name: string }>(actor, "select name from storage.objects where bucket_id = 'announcement-images' order by name")).map(
          (r) => r.name,
        );
      expect(await names(anon)).toEqual(["public.png"]);
      expect(await names(as(member))).toEqual(["members.png", "public.png"]);
      expect(await names(as(editor))).toEqual(["members.png", "orphan.png", "public.png"]);
    });

    it("allows branding uploads only for settings managers", async () => {
      await expect(
        db.query(as(editor), "insert into storage.objects (bucket_id, name) values ('branding', 'logo/x.png')"),
      ).rejects.toThrow(/row-level security/);
      await db.query(as(superAdmin), "insert into storage.objects (bucket_id, name) values ('branding', 'logo/x.png')");
    });

    it("restricts the Phase 1 buckets to raster image types", async () => {
      const buckets = await db.raw("select id, allowed_mime_types from storage.buckets where id in ('branding', 'announcement-images')");
      expect(buckets).toHaveLength(2);
      for (const b of buckets) expect(b.allowed_mime_types).toEqual(["image/png", "image/jpeg", "image/webp"]);
    });
  });

  describe("audit log access", () => {
    it("is readable only with audit.view and never writable by clients", async () => {
      expect(await db.query(as(memberAdmin), "select id from public.audit_log")).toHaveLength(0);
      expect(await db.query(as(editor), "select id from public.audit_log")).toHaveLength(0);
      await expect(
        db.query(as(superAdmin), "insert into public.audit_log (action) values ('fake.entry')"),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query(as(superAdmin), "delete from public.audit_log")).rejects.toThrow(/permission denied/);
    });
  });
});
