import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Hosted Supabase loads pg-safeupdate for API sessions, which rejects any
 * UPDATE or DELETE without a WHERE clause ("UPDATE requires a WHERE clause").
 * The local test database doesn't load it, so this scans every function the
 * migrations define for statements that would fail there.
 */
function unguardedStatements(source: string): string[] {
  const code = source.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
  const found: string[] = [];
  for (const statement of code.split(";")) {
    // "update <table> set" (not "do update set", "for update", or trigger events) and "delete from".
    const match = /\bupdate\s+(?!set\b)[\w."]+(?:\s+(?:as\s+)?\w+)?\s+set\b|\bdelete\s+from\b/i.exec(statement);
    if (match && !/\bwhere\b/i.test(statement.slice(match.index))) found.push(statement.trim().split(/\s+/).slice(0, 6).join(" "));
  }
  return found;
}

describe("unguardedStatements", () => {
  it("flags only UPDATE and DELETE statements without WHERE", () => {
    expect(unguardedStatements("update events.settings set x = 1;")).toHaveLength(1);
    expect(unguardedStatements("delete from t;")).toHaveLength(1);
    expect(unguardedStatements("update events.settings set x = 1 where id;")).toEqual([]);
    expect(unguardedStatements("insert into t values (1) on conflict (id) do update set x = 1;")).toEqual([]);
    expect(unguardedStatements("select 1 from t for update skip locked;")).toEqual([]);
    expect(unguardedStatements("-- update t set x = 1\nselect 'delete from t';")).toEqual([]);
  });
});

describeDb("pg-safeupdate compatibility", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await TestDb.create();
  }, 120_000);
  afterAll(async () => {
    await db?.destroy();
  });

  it("has no UPDATE or DELETE without a WHERE clause in any app function", async () => {
    const { rows } = await db.client.query<{ name: string; src: string }>(
      `select n.nspname || '.' || p.proname as name, p.prosrc as src
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'auth', 'storage')
          and p.prolang in (select oid from pg_language where lanname in ('sql', 'plpgsql'))`,
    );
    const offenders = rows.flatMap((r) => unguardedStatements(r.src).map((s) => `${r.name}: ${s}`));
    expect(offenders).toEqual([]);
  });
});
