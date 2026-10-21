import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb, as, service } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Google and Apple accounts as Supabase Auth writes them to auth.users
 * (simulated rows: no provider is contacted). They must get exactly what an
 * email registration gets: a pending profile, no roles, and nothing taken from
 * provider metadata except the display name.
 */
describeDb("Google and Apple sign-in (database)", () => {
  let db: TestDb;
  let superAdmin: string;
  let memberAdmin: string;

  async function createOAuthUser(email: string | null, provider: "google" | "apple", userMeta: object) {
    const rows = await db.raw<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) values ($1, $2, $3, now()) returning id",
      [email, JSON.stringify(userMeta), JSON.stringify({ provider, providers: [provider] })],
    );
    return rows[0].id;
  }
  const profileOf = async (id: string) =>
    (await db.raw("select email, full_name, preferred_name, membership_status::text, status_changed_at from public.profiles where id = $1", [id]))[0];
  const rolesOf = async (id: string) => (await db.raw("select role_key from public.user_roles where user_id = $1", [id])).map((r) => r.role_key);
  const caps = async (id: string) =>
    (await db.query<{ c: string }>(as(id), "select c from public.my_capabilities() c")).map((r) => r.c);

  beforeAll(async () => {
    db = await TestDb.create();
    superAdmin = await db.createAuthUser("super@example.test", { fullName: "Synthetic Super" });
    await db.query(service, "select public.bootstrap_super_admin($1)", ["super@example.test"]);
    memberAdmin = await db.createAuthUser("membership@example.test");
    await db.setStatus(memberAdmin, "approved");
    await db.grantRole(memberAdmin, "membership_admin");
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it("gives a new Google account a pending profile with its Google name and no roles", async () => {
    const id = await createOAuthUser("ruth.test@gmail.example", "google", {
      iss: "https://accounts.google.com",
      sub: "1098765",
      name: "Ruth Example",
      full_name: "Ruth Example",
      email: "ruth.test@gmail.example",
      email_verified: true,
      avatar_url: "https://lh3.example/photo.jpg",
      provider_id: "1098765",
    });
    expect(await profileOf(id)).toEqual({
      email: "ruth.test@gmail.example",
      full_name: "Ruth Example",
      preferred_name: null,
      membership_status: "pending",
      status_changed_at: null,
    });
    expect(await rolesOf(id)).toEqual([]);
    expect(await caps(id)).toEqual([]);
    const [{ ok }] = await db.query(as(id), "select public.is_approved_member() as ok");
    expect(ok).toBe(false);
  });

  it("gives a new Apple account (private relay, no name) a pending profile with an empty name", async () => {
    const id = await createOAuthUser("x7k2q9abcd@privaterelay.appleid.com", "apple", {
      iss: "https://appleid.apple.com",
      sub: "000123.abcdef.0456",
      email: "x7k2q9abcd@privaterelay.appleid.com",
      email_verified: true,
      is_private_email: true,
      provider_id: "000123.abcdef.0456",
    });
    expect(await profileOf(id)).toMatchObject({ email: "x7k2q9abcd@privaterelay.appleid.com", full_name: "", membership_status: "pending" });
    expect(await rolesOf(id)).toEqual([]);
  });

  it("lets the member supply the missing name, but not their status", async () => {
    const id = await createOAuthUser("noname@privaterelay.appleid.com", "apple", { sub: "000999.x" });
    await db.query(as(id), "update public.profiles set full_name = $2, preferred_name = $3 where id = $1", [id, "Boaz Example", "Bo"]);
    expect(await profileOf(id)).toMatchObject({ full_name: "Boaz Example", preferred_name: "Bo", membership_status: "pending" });
    await expect(db.query(as(id), "update public.profiles set membership_status = 'approved' where id = $1", [id])).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query(as(id), "insert into public.user_roles (user_id, role_key) values ($1, 'super_admin')", [id])).rejects.toThrow();
    expect(await profileOf(id)).toMatchObject({ membership_status: "pending" });
  });

  it("ignores forged role and status claims in provider metadata", async () => {
    const id = await createOAuthUser("forger@gmail.example", "google", {
      full_name: "Forger",
      role: "super_admin",
      roles: ["super_admin"],
      membership_status: "approved",
      account_kind: "youth",
    });
    expect(await profileOf(id)).toMatchObject({ membership_status: "pending" });
    expect(await rolesOf(id)).toEqual([]);
    const [{ account_kind }] = await db.raw("select account_kind from public.profiles where id = $1", [id]);
    expect(account_kind).toBe("adult");
  });

  it("does not approve by email domain", async () => {
    const id = await createOAuthUser("pastor@gathering.church", "google", { full_name: "Same Domain" });
    expect(await profileOf(id)).toMatchObject({ membership_status: "pending" });
  });

  it("applies approval and suspension to a social account immediately", async () => {
    const id = await createOAuthUser("approve.me@gmail.example", "google", { full_name: "Approve Me" });
    await db.query(as(memberAdmin), "select public.admin_set_membership_status($1, 'approved')", [id]);
    expect((await db.query(as(id), "select public.is_approved_member() as ok"))[0].ok).toBe(true);
    await db.query(as(memberAdmin), "select public.admin_set_membership_status($1, 'suspended')", [id]);
    expect((await db.query(as(id), "select public.is_approved_member() as ok"))[0].ok).toBe(false);
  });

  it("keeps an existing member's profile and roles when Supabase links another identity", async () => {
    const id = await db.createAuthUser("longtime@example.test", { fullName: "Longtime Member" });
    await db.setStatus(id, "approved");
    await db.grantRole(id, "content_editor");
    const before = await profileOf(id);
    // Linking adds an auth.identities row and updates the provider list on the
    // same auth.users row; it never inserts a second user.
    await db.raw(
      `update auth.users set raw_app_meta_data = '{"provider":"email","providers":["email","google"]}'::jsonb,
                             raw_user_meta_data = raw_user_meta_data || '{"full_name":"Google Name","avatar_url":"x"}'::jsonb
        where id = $1`,
      [id],
    );
    expect(await profileOf(id)).toEqual(before);
    expect(await rolesOf(id)).toEqual(["content_editor"]);
    expect((await db.raw("select count(*)::int as n from public.profiles where email = 'longtime@example.test'"))[0].n).toBe(1);
  });

  it("keeps the one-time super administrator bootstrap closed", async () => {
    const id = await createOAuthUser("second.super@gmail.example", "google", { full_name: "Would-be Super" });
    await expect(db.query(service, "select public.bootstrap_super_admin('second.super@gmail.example')")).rejects.toThrow(
      /already been appointed/,
    );
    expect(await rolesOf(id)).toEqual([]);
    expect(await rolesOf(superAdmin)).toEqual(["super_admin"]);
  });
});
