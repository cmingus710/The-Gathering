import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Integration-test harness: creates a throwaway PostgreSQL database, applies
 * the Supabase shim plus every migration in order, and runs queries as the
 * same database roles Supabase uses (anon / authenticated / service_role)
 * with a JWT "sub" claim, so RLS and grants are exercised for real.
 */
const ROOT = path.resolve(__dirname, "../..");
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export type Actor = { role: "anon" } | { role: "service_role" } | { role: "authenticated"; userId: string };

export const anon: Actor = { role: "anon" };
export const service: Actor = { role: "service_role" };
export const as = (userId: string): Actor => ({ role: "authenticated", userId });

export class TestDb {
  private constructor(
    private readonly admin: Client,
    readonly client: Client,
    private readonly name: string,
  ) {}

  /** `before`: apply only the migrations whose version sorts before it (see applyMigrations). */
  static async create(opts: { before?: string } = {}): Promise<TestDb> {
    if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
    const name = `gathering_test_${process.pid}_${Date.now()}`;
    const admin = new Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    await client.query(readFileSync(path.join(ROOT, "supabase/tests/supabase-shim.sql"), "utf8"));
    const db = new TestDb(admin, client, name);
    await db.applyMigrations({ before: opts.before });
    return db;
  }

  /** Applies migrations in order: those from `from` (inclusive) and before `before`. */
  async applyMigrations(opts: { from?: string; before?: string } = {}) {
    const dir = path.join(ROOT, "supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (opts.from && file < opts.from) continue;
      if (opts.before && file >= opts.before) continue;
      await this.client.query(readFileSync(path.join(dir, file), "utf8"));
    }
  }

  async destroy() {
    await this.client.end();
    await this.admin.query(`drop database if exists ${this.name} with (force)`);
    await this.admin.end();
  }

  /** Runs one statement as the given actor inside its own transaction. */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    actor: Actor,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await this.client.query("begin");
    try {
      await this.client.query(`set local role ${actor.role}`);
      const claims = actor.role === "authenticated" ? { sub: actor.userId, role: "authenticated" } : { role: actor.role };
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const result = await this.client.query(sql, params);
      await this.client.query("commit");
      return result.rows as T[];
    } catch (error) {
      await this.client.query("rollback");
      throw error;
    }
  }

  /** A separate connection to the same database (for concurrency tests). */
  async connect(): Promise<Client> {
    const url = new URL(TEST_DATABASE_URL!);
    url.pathname = `/${this.name}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    return client;
  }

  /** Superuser query (test setup only, bypasses RLS). */
  async raw<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return (await this.client.query(sql, params)).rows as T[];
  }

  /** Simulates Supabase Auth creating a user (fires the profile trigger). */
  async createAuthUser(email: string, opts: { fullName?: string; verified?: boolean; metadata?: object } = {}) {
    const meta = { full_name: opts.fullName ?? email.split("@")[0], ...(opts.metadata ?? {}) };
    const rows = await this.raw<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3) returning id",
      [email, JSON.stringify(meta), opts.verified === false ? null : new Date()],
    );
    return rows[0].id;
  }

  async setStatus(userId: string, status: "pending" | "approved" | "suspended") {
    await this.raw("update public.profiles set membership_status = $2 where id = $1", [userId, status]);
  }

  async grantRole(userId: string, role: string) {
    await this.raw("insert into public.user_roles (user_id, role_key) values ($1, $2) on conflict do nothing", [userId, role]);
  }
}
