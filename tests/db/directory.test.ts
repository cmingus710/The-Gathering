import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, anon, as } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Phase 2: profiles, directory privacy, photos, households, and admin
 * correction. All accounts and values are synthetic.
 */
describeDb("member directory, privacy, photos, and households", () => {
  let db: TestDb;
  let superAdmin: string;
  let memberAdmin: string;
  let editor: string;
  let alice: string; // approved, shares some details
  let bob: string; // approved, defaults
  let carol: string; // approved, hidden from directory
  let pending: string;
  let suspended: string;

  const search = (actor: string, q: string | null = null) =>
    db.query<{ id: string; display_name: string; city: string | null; photo_path: string | null }>(
      as(actor),
      "select * from public.directory_search($1, 50, 0)",
      [q],
    );
  const detail = (actor: string, id: string) =>
    db.query<Record<string, unknown>>(as(actor), "select * from public.directory_member($1)", [id]);

  beforeAll(async () => {
    db = await TestDb.create();
    superAdmin = await db.createAuthUser("super@example.test", { fullName: "Synthetic Super" });
    await db.raw("select public.bootstrap_super_admin('super@example.test')");
    memberAdmin = await db.createAuthUser("membership@example.test", { fullName: "Synthetic Membership" });
    editor = await db.createAuthUser("editor@example.test", { fullName: "Synthetic Editor" });
    alice = await db.createAuthUser("alice@example.test", { fullName: "Alice Example" });
    bob = await db.createAuthUser("bob@example.test", { fullName: "Bob Sample" });
    carol = await db.createAuthUser("carol@example.test", { fullName: "Carol Hidden" });
    pending = await db.createAuthUser("pending@example.test", { fullName: "Pending Person" });
    suspended = await db.createAuthUser("suspended@example.test", { fullName: "Suspended Person" });
    for (const id of [memberAdmin, editor, alice, bob, carol, suspended]) await db.setStatus(id, "approved");
    await db.grantRole(memberAdmin, "membership_admin");
    await db.grantRole(editor, "content_editor");
    await db.setStatus(suspended, "suspended");

    // Alice fills in details and shares phone + city; Bob fills in details but keeps defaults.
    await db.query(as(alice), "update public.profiles set phone = '555-0101' where id = $1", [alice]);
    await db.query(
      as(alice),
      `update public.member_profile_details
          set contact_email = 'alice.contact@example.test', street_address = '1 Synthetic Way', city = 'Testville',
              state_region = 'TS', postal_code = '00001', birthday_month = 2, birthday_day = 29, bio = 'Synthetic bio',
              show_phone = true
        where profile_id = $1`,
      [alice],
    );
    await db.query(as(bob), "update public.profiles set phone = '555-0102' where id = $1", [bob]);
    await db.query(
      as(bob),
      `update public.member_profile_details
          set contact_email = 'bob.contact@example.test', street_address = '2 Hidden Lane', city = 'Secretburg',
              state_region = 'HS', birthday_month = 7, birthday_day = 4
        where profile_id = $1`,
      [bob],
    );
    await db.query(as(bob), "update public.member_profile_details set show_city_state = false where profile_id = $1", [bob]);
    await db.query(as(carol), "update public.member_profile_details set directory_listed = false, city = 'Testville' where profile_id = $1", [carol]);
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe("profiles", () => {
    it("creates a details row with privacy-preserving defaults at registration", async () => {
      const id = await db.createAuthUser("fresh@example.test", { fullName: "Fresh Person" });
      const [d] = await db.query(as(id), "select * from public.member_profile_details where profile_id = $1", [id]);
      expect(d).toMatchObject({
        directory_listed: true,
        show_photo: true,
        show_city_state: true,
        show_ministry_interests: true,
        show_household: true,
        show_contact_email: false,
        show_phone: false,
        show_street_address: false,
        show_birthday: false,
        contact_email: null,
        photo_path: null,
      });
    });

    it("derives the full name from first and last name", async () => {
      const id = await db.createAuthUser("names@example.test", { fullName: "Old Name" });
      await db.query(as(id), "update public.profiles set first_name = ' New ', last_name = 'Person' where id = $1", [id]);
      const [p] = await db.raw("select first_name, last_name, full_name from public.profiles where id = $1", [id]);
      expect(p).toEqual({ first_name: "New", last_name: "Person", full_name: "New Person" });
    });

    it("keeps the directory contact email separate from the sign-in email", async () => {
      const [p] = await db.raw("select email from public.profiles where id = $1", [alice]);
      const [u] = await db.raw("select email from auth.users where id = $1", [alice]);
      expect(p.email).toBe("alice@example.test");
      expect(u.email).toBe("alice@example.test");
    });

    it("validates birthdays (month/day only) and contact email format", async () => {
      await expect(
        db.query(as(bob), "update public.member_profile_details set birthday_month = 2, birthday_day = 30 where profile_id = $1", [bob]),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query(as(bob), "update public.member_profile_details set birthday_month = 5, birthday_day = null where profile_id = $1", [bob]),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query(as(bob), "update public.member_profile_details set contact_email = 'not-an-email' where profile_id = $1", [bob]),
      ).rejects.toThrow(/check constraint/);
    });

    it("changes account kind only through the youth process (Phase 10)", async () => {
      await expect(db.raw("update public.profiles set account_kind = 'youth' where id = $1", [bob])).rejects.toThrow(
        /youth and family process/,
      );
      await expect(db.query(as(bob), "update public.profiles set account_kind = 'youth' where id = $1", [bob])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe("cross-account protection", () => {
    it("blocks reading other members' profiles and details directly", async () => {
      expect(await db.query(as(alice), "select * from public.profiles where id = $1", [bob])).toHaveLength(0);
      expect(await db.query(as(alice), "select * from public.member_profile_details where profile_id <> $1", [alice])).toHaveLength(0);
      expect(await db.query(as(alice), "select * from public.member_ministry_interests where profile_id <> $1", [alice])).toHaveLength(0);
    });

    it("blocks editing someone else's details, and pointing a photo at another member's folder", async () => {
      const rows = await db.query(as(alice), "update public.member_profile_details set city = 'Hacked' where profile_id = $1 returning 1", [bob]);
      expect(rows).toHaveLength(0);
      await expect(
        db.query(as(alice), "update public.member_profile_details set photo_path = $2 where profile_id = $1", [alice, `${bob}/abcdefgh.webp`]),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query(as(alice), "update public.member_profile_details set profile_id = $2 where profile_id = $1", [alice, bob]),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query(as(alice), "insert into public.member_profile_details (profile_id) values ($1)", [alice])).rejects.toThrow(
        /permission denied/,
      );
    });

    it("blocks pending and suspended members from editing details", async () => {
      expect(
        await db.query(as(pending), "update public.member_profile_details set city = 'X' where profile_id = $1 returning 1", [pending]),
      ).toHaveLength(0);
      expect(
        await db.query(as(suspended), "update public.member_profile_details set city = 'X' where profile_id = $1 returning 1", [suspended]),
      ).toHaveLength(0);
    });

    it("gives anonymous visitors no access at all", async () => {
      await expect(db.query(anon, "select * from public.member_profile_details")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select * from public.directory_search(null, 10, 0)")).rejects.toThrow(/permission denied/);
      await expect(db.query(anon, "select * from public.households")).rejects.toThrow(/permission denied/);
    });
  });

  describe("directory", () => {
    it("denies pending and suspended accounts", async () => {
      await expect(search(pending)).rejects.toThrow(/Only approved members/);
      await expect(search(suspended)).rejects.toThrow(/Only approved members/);
      await expect(detail(suspended, alice)).rejects.toThrow(/Only approved members/);
    });

    it("lists only approved, listed adults", async () => {
      const ids = (await search(alice)).map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([alice, bob, superAdmin, memberAdmin, editor]));
      expect(ids).not.toContain(carol);
      expect(ids).not.toContain(pending);
      expect(ids).not.toContain(suspended);
    });

    it("returns shared fields and drops hidden ones (privacy defaults)", async () => {
      const [a] = await detail(bob, alice);
      expect(a).toMatchObject({ display_name: "Alice Example", phone: "555-0101", city: "Testville", bio: "Synthetic bio" });
      expect(a).toMatchObject({ contact_email: null, street_address: null, postal_code: null, birthday_month: null, birthday_day: null });

      const [b] = await detail(alice, bob);
      expect(b).toMatchObject({ phone: null, contact_email: null, street_address: null, city: null, state_region: null, birthday_month: null });
      // The projection never includes the sign-in email, status, or roles.
      expect(Object.keys(b)).not.toEqual(expect.arrayContaining(["email"]));
      expect(Object.keys(b)).not.toContain("membership_status");
    });

    it("never returns hidden values anywhere in the response", async () => {
      const raw = JSON.stringify([...(await search(alice)), ...(await detail(alice, bob))]);
      for (const hidden of ["bob.contact@example.test", "2 Hidden Lane", "Secretburg", "555-0102", "bob@example.test"]) {
        expect(raw).not.toContain(hidden);
      }
    });

    it("searches visible names and shared cities only", async () => {
      expect((await search(bob, "alice")).map((r) => r.id)).toEqual([alice]);
      expect((await search(bob, "testville")).map((r) => r.id)).toEqual([alice]); // Carol's matching city is hidden with her listing
      for (const hidden of ["Secretburg", "bob.contact", "Hidden Lane", "555-0102", "bob@example"]) {
        expect(await search(alice, hidden)).toHaveLength(0);
      }
      // LIKE wildcards are literal.
      expect(await search(alice, "%")).toHaveLength(0);
    });

    it("honours opting out, while membership admins still see the member", async () => {
      expect(await detail(alice, carol)).toHaveLength(0);
      const [d] = await db.query(as(memberAdmin), "select directory_listed from public.member_profile_details where profile_id = $1", [carol]);
      expect(d.directory_listed).toBe(false);
      expect(await db.query(as(memberAdmin), "select id from public.profiles where id = $1", [carol])).toHaveLength(1);
    });

    it("shows a returning member again only when they choose", async () => {
      await db.query(as(carol), "update public.member_profile_details set directory_listed = true where profile_id = $1", [carol]);
      expect((await search(alice)).map((r) => r.id)).toContain(carol);
      await db.query(as(carol), "update public.member_profile_details set directory_listed = false where profile_id = $1", [carol]);
      expect((await search(alice)).map((r) => r.id)).not.toContain(carol);
    });

    it("drops a member as soon as they are suspended", async () => {
      await db.setStatus(bob, "suspended");
      expect((await search(alice)).map((r) => r.id)).not.toContain(bob);
      expect(await detail(alice, bob)).toHaveLength(0);
      await db.setStatus(bob, "approved");
    });

    it("pages results", async () => {
      const page1 = await db.query<{ id: string; total_count: string }>(as(alice), "select * from public.directory_search(null, 2, 0)");
      const page2 = await db.query<{ id: string }>(as(alice), "select * from public.directory_search(null, 2, 2)");
      expect(page1).toHaveLength(2);
      expect(Number(page1[0].total_count)).toBeGreaterThanOrEqual(5);
      expect(page2.map((r) => r.id)).not.toEqual(expect.arrayContaining(page1.map((r) => r.id)));
    });
  });

  describe("roles and private data", () => {
    it("keeps content editors out of private member data", async () => {
      expect(await db.query(as(editor), "select * from public.member_profile_details where profile_id = $1", [bob])).toHaveLength(0);
      expect(await db.query(as(editor), "select * from public.profiles where id = $1", [bob])).toHaveLength(0);
      const [b] = await detail(editor, bob);
      expect(b.phone).toBeNull();
      await expect(
        db.query(as(editor), "select public.admin_update_member_profile($1, 'X', null, null, null, null, null, null, null, null, null, null, null)", [bob]),
      ).rejects.toThrow(/permission/);
    });

    it("lets membership admins correct a profile, auditing field names only", async () => {
      const [{ fields }] = await db.query<{ fields: string[] }>(
        as(memberAdmin),
        `select public.admin_update_member_profile($1, 'Bobby', 'Sample', null, '555-0199', 'bob.contact@example.test',
           '2 Hidden Lane', 'Secretburg', 'HS', null, null, 7, 4) as fields`,
        [bob],
      );
      expect(fields).toEqual(["first_name", "last_name", "phone"]);
      const [audit] = await db.raw("select actor_id, action, details from public.audit_log where action = 'profile.admin_updated' order by id desc limit 1");
      expect(audit).toEqual({ actor_id: memberAdmin, action: "profile.admin_updated", details: { fields: ["first_name", "last_name", "phone"] } });
      expect(JSON.stringify(audit)).not.toContain("555-0199");
      const [p] = await db.raw("select full_name, phone from public.profiles where id = $1", [bob]);
      expect(p).toEqual({ full_name: "Bobby Sample", phone: "555-0199" });
    });

    it("does not let membership admins change privacy choices or edit a super admin", async () => {
      expect(
        await db.query(as(memberAdmin), "update public.member_profile_details set show_phone = true where profile_id = $1 returning 1", [bob]),
      ).toHaveLength(0);
      await expect(
        db.query(as(memberAdmin), "select public.admin_update_member_profile($1, 'X', null, null, null, null, null, null, null, null, null, null, null)", [superAdmin]),
      ).rejects.toThrow(/super administrator/);
    });

    it("still blocks members from changing their own status or roles", async () => {
      await expect(db.query(as(alice), "select public.admin_set_membership_status($1, 'suspended')", [bob])).rejects.toThrow(/permission/);
      await expect(db.query(as(alice), "select public.admin_grant_role($1, 'membership_admin')", [alice])).rejects.toThrow(/permission/);
    });
  });

  describe("ministry interests", () => {
    let music: string;
    let archived: string;

    beforeAll(async () => {
      [{ id: music }] = await db.query<{ id: string }>(as(memberAdmin), "insert into public.ministry_interests (label) values ('Synthetic Music') returning id");
      [{ id: archived }] = await db.query<{ id: string }>(
        as(memberAdmin),
        "insert into public.ministry_interests (label, active) values ('Synthetic Archived', false) returning id",
      );
    });

    it("lets only membership managers edit the catalog, with an audit entry", async () => {
      await expect(db.query(as(alice), "insert into public.ministry_interests (label) values ('X')")).rejects.toThrow(/row-level security/);
      await expect(db.query(as(editor), "insert into public.ministry_interests (label) values ('X')")).rejects.toThrow(/row-level security/);
      const [a] = await db.raw("select actor_id from public.audit_log where action = 'ministry_interest.created' and target_id = $1", [music]);
      expect(a.actor_id).toBe(memberAdmin);
    });

    it("lets members choose their own active interests only", async () => {
      await db.query(as(alice), "insert into public.member_ministry_interests (profile_id, interest_id) values ($1, $2)", [alice, music]);
      await expect(
        db.query(as(alice), "insert into public.member_ministry_interests (profile_id, interest_id) values ($1, $2)", [bob, music]),
      ).rejects.toThrow(/row-level security/);
      await expect(
        db.query(as(alice), "insert into public.member_ministry_interests (profile_id, interest_id) values ($1, $2)", [alice, archived]),
      ).rejects.toThrow(/row-level security/);
      expect(await db.query(as(alice), "select id from public.ministry_interests where id = $1", [archived])).toHaveLength(0);
    });

    it("shows interests in the directory only when shared", async () => {
      expect((await detail(bob, alice))[0].ministry_interests).toEqual(["Synthetic Music"]);
      await db.query(as(alice), "update public.member_profile_details set show_ministry_interests = false where profile_id = $1", [alice]);
      expect((await detail(bob, alice))[0].ministry_interests).toBeNull();
      await db.query(as(alice), "update public.member_profile_details set show_ministry_interests = true where profile_id = $1", [alice]);
    });
  });

  describe("profile photos", () => {
    const photo = (id: string, name = "photoaaaa1") => `${id}/${name}.webp`;
    const canRead = async (actor: string, name: string) =>
      (await db.query(as(actor), "select name from storage.objects where bucket_id = 'profile-photos' and name = $1", [name])).length === 1;

    it("lets approved members upload only into their own folder", async () => {
      await db.query(as(alice), "insert into storage.objects (bucket_id, name) values ('profile-photos', $1)", [photo(alice)]);
      await expect(
        db.query(as(alice), "insert into storage.objects (bucket_id, name) values ('profile-photos', $1)", [photo(bob)]),
      ).rejects.toThrow(/row-level security/);
      await expect(
        db.query(as(pending), "insert into storage.objects (bucket_id, name) values ('profile-photos', $1)", [photo(pending)]),
      ).rejects.toThrow(/row-level security/);
      await db.query(as(alice), "update public.member_profile_details set photo_path = $2 where profile_id = $1", [alice, photo(alice)]);
    });

    it("is private, WebP only, and size-limited", async () => {
      const [b] = await db.raw("select public, allowed_mime_types, file_size_limit from storage.buckets where id = 'profile-photos'");
      expect(b).toEqual({ public: false, allowed_mime_types: ["image/webp"], file_size_limit: "1048576" });
    });

    it("follows the owner's photo visibility", async () => {
      expect(await canRead(bob, photo(alice))).toBe(true);
      expect(await canRead(alice, photo(alice))).toBe(true);
      expect(await canRead(pending, photo(alice))).toBe(false);
      expect(await canRead(suspended, photo(alice))).toBe(false);

      await db.query(as(alice), "update public.member_profile_details set show_photo = false where profile_id = $1", [alice]);
      expect(await canRead(bob, photo(alice))).toBe(false);
      expect(await canRead(editor, photo(alice))).toBe(false);
      expect(await canRead(memberAdmin, photo(alice))).toBe(true);
      expect((await detail(bob, alice))[0].photo_path).toBeNull();
      await db.query(as(alice), "update public.member_profile_details set show_photo = true where profile_id = $1", [alice]);
    });

    it("hides a photo when its owner leaves the directory", async () => {
      await db.query(as(alice), "update public.member_profile_details set directory_listed = false where profile_id = $1", [alice]);
      expect(await canRead(bob, photo(alice))).toBe(false);
      await db.query(as(alice), "update public.member_profile_details set directory_listed = true where profile_id = $1", [alice]);
    });

    it("stops serving a replaced photo, and lets the owner delete old files", async () => {
      await db.query(as(alice), "insert into storage.objects (bucket_id, name) values ('profile-photos', $1)", [photo(alice, "photobbbb2")]);
      await db.query(as(alice), "update public.member_profile_details set photo_path = $2 where profile_id = $1", [alice, photo(alice, "photobbbb2")]);
      expect(await canRead(bob, photo(alice))).toBe(false);
      expect(await canRead(bob, photo(alice, "photobbbb2"))).toBe(true);
      expect(await db.query(as(bob), "delete from storage.objects where name = $1 returning 1", [photo(alice, "photobbbb2")])).toHaveLength(0);
      expect(await db.query(as(alice), "delete from storage.objects where name = $1 returning 1", [photo(alice)])).toHaveLength(1);
    });

    it("has no update path (replacements are always new objects)", async () => {
      expect(
        await db.query(as(alice), "update storage.objects set name = name where bucket_id = 'profile-photos' returning 1"),
      ).toHaveLength(0);
    });
  });

  describe("households", () => {
    let household: string;
    const myHousehold = async (actor: string) =>
      (await db.query<{ h: Record<string, unknown> | null }>(as(actor), "select public.my_household() as h"))[0].h;
    const invite = async (actor: string, invitee: string) =>
      (await db.query<{ id: string }>(as(actor), "select public.household_invite($1) as id", [invitee]))[0].id;
    const respond = async (actor: string, id: string, accept: boolean) =>
      (await db.query<{ r: string }>(as(actor), "select public.household_respond($1, $2) as r", [id, accept]))[0].r;

    it("creates a household for an approved adult", async () => {
      [{ id: household }] = await db.query<{ id: string }>(as(alice), "select public.household_create('Synthetic Household') as id");
      expect(await myHousehold(alice)).toMatchObject({ id: household, display_name: "Synthetic Household" });
      await expect(db.query(as(alice), "select public.household_create(null)")).rejects.toThrow(/already in a household/);
      await expect(db.query(as(pending), "select public.household_create(null)")).rejects.toThrow(/Only approved members/);
    });

    it("has no direct write path", async () => {
      await expect(db.query(as(bob), "insert into public.household_members (household_id, profile_id) values ($1, $2)", [household, bob])).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query(as(bob), "insert into public.households (display_name) values ('X')")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(alice), "update public.household_invitations set status = 'accepted'")).rejects.toThrow(/permission denied/);
      await expect(db.query(as(alice), "select * from public.guardianships")).rejects.toThrow(/permission denied/);
    });

    it("invites only directory-listed members, with one message for every refusal", async () => {
      for (const target of [carol, pending, suspended, "00000000-0000-0000-0000-000000000000"]) {
        await expect(invite(alice, target)).rejects.toThrow(/can't be invited/);
      }
      await expect(invite(bob, alice)).rejects.toThrow(/Create a household/);
    });

    it("keeps invitations private to the household and the invitee", async () => {
      const id = await invite(alice, bob);
      expect(await invite(alice, bob)).toBe(id); // idempotent
      expect(await db.query(as(editor), "select * from public.household_invitations")).toHaveLength(0);
      expect(await db.query(as(editor), "select * from public.households")).toHaveLength(0);
      expect(await db.query(as(bob), "select id from public.household_invitations")).toHaveLength(1);
      const [inv] = await db.query(as(bob), "select * from public.my_household_invitations()");
      expect(inv).toMatchObject({ id, household_name: "Synthetic Household", invited_by_name: "Alice Example" });
      // Someone else can't answer it.
      await expect(respond(editor, id, true)).rejects.toThrow(/no longer available/);
    });

    it("declines once, and a replayed answer is refused", async () => {
      const [{ id }] = await db.query<{ id: string }>(as(bob), "select id from public.household_invitations where status = 'pending'");
      expect(await respond(bob, id, false)).toBe("declined");
      await expect(respond(bob, id, true)).rejects.toThrow(/no longer available/);
      expect(await myHousehold(bob)).toBeNull();
    });

    it("revokes an open invitation", async () => {
      const id = await invite(alice, bob);
      await db.query(as(alice), "select public.household_revoke_invitation($1)", [id]);
      await expect(respond(bob, id, true)).rejects.toThrow(/no longer available/);
      await expect(db.query(as(editor), "select public.household_revoke_invitation($1)", [id])).rejects.toThrow(/no longer open/);
    });

    it("expires invitations", async () => {
      const id = await invite(alice, bob);
      await db.raw("update public.household_invitations set expires_at = now() - interval '1 minute' where id = $1", [id]);
      expect(await db.query(as(bob), "select * from public.my_household_invitations()")).toHaveLength(0);
      expect(await respond(bob, id, true)).toBe("expired");
      const [row] = await db.raw("select status from public.household_invitations where id = $1", [id]);
      expect(row.status).toBe("expired");
      await expect(respond(bob, id, true)).rejects.toThrow(/no longer available/);
      expect(await myHousehold(bob)).toBeNull();
    });

    it("accepts once, then the invitation can't be replayed", async () => {
      const id = await invite(alice, bob);
      expect(await respond(bob, id, true)).toBe("accepted");
      await expect(respond(bob, id, true)).rejects.toThrow(/no longer available/);
      const h = await myHousehold(bob);
      expect((h?.members as Array<{ id: string }>).map((m) => m.id).sort()).toEqual([alice, bob].sort());
    });

    it("never reveals hidden details or grants account access to household members", async () => {
      const [b] = await detail(alice, bob);
      expect(b).toMatchObject({ contact_email: null, street_address: null, birthday_month: null });
      expect(await db.query(as(alice), "select * from public.member_profile_details where profile_id = $1", [bob])).toHaveLength(0);
      expect(await db.query(as(alice), "update public.profiles set full_name = 'X' where id = $1 returning 1", [bob])).toHaveLength(0);
      expect(await db.raw("select * from public.guardianships")).toHaveLength(0);
    });

    it("shows the household in the directory only with each adult's consent", async () => {
      const [a] = await detail(editor, alice);
      expect(a.household_name).toBe("Synthetic Household");
      expect(a.household_members).toEqual([{ id: bob, display_name: "Bobby Sample" }]);

      await db.query(as(bob), "update public.member_profile_details set show_household = false where profile_id = $1", [bob]);
      expect((await detail(editor, alice))[0].household_members).toBeNull();
      expect((await detail(editor, bob))[0].household_members).toBeNull();
      await db.query(as(bob), "update public.member_profile_details set show_household = true where profile_id = $1", [bob]);

      await db.query(as(bob), "update public.member_profile_details set directory_listed = false where profile_id = $1", [bob]);
      expect((await detail(editor, alice))[0].household_members).toBeNull();
      await db.query(as(bob), "update public.member_profile_details set directory_listed = true where profile_id = $1", [bob]);
    });

    it("refuses joining a second household, and closes a household when the last adult leaves", async () => {
      const [{ id: other }] = await db.query<{ id: string }>(as(memberAdmin), "select public.household_create(null) as id");
      const inv = await invite(memberAdmin, bob);
      await expect(respond(bob, inv, true)).rejects.toThrow(/Leave your current household/);

      await db.query(as(bob), "select public.household_leave()");
      expect(await myHousehold(bob)).toBeNull();
      expect(await respond(bob, inv, true)).toBe("accepted");
      await db.query(as(alice), "select public.household_leave()");
      expect(await db.raw("select id from public.households where id = $1", [household])).toHaveLength(0);
      expect(await db.raw("select id from public.households where id = $1", [other])).toHaveLength(1);
    });
  });
});
