import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearTextCache, type Fetcher } from "@/lib/bible/source";
import type { Verse } from "@/lib/bible/types";
import { fetchMemoryText, fingerprintVerses, providerPayload, verseDifferences } from "./provider";

const v = (c: number, n: number, t: string, o = false): Verse => ({ c, v: n, t, o, h: null, p: false, q: false });

describe("licensed memory passages", () => {
  it("fingerprints the exact wording one way, ignoring omitted verses", () => {
    const verses = [v(8, 36, "First words."), v(8, 37, "", true), v(8, 38, "Last words.")];
    const expected = createHash("sha256").update("8:36\tFirst words.\n8:38\tLast words.\n").digest("hex");
    expect(fingerprintVerses(verses)).toBe(expected);
    expect(fingerprintVerses([v(8, 36, "First words!"), v(8, 38, "Last words.")])).not.toBe(expected);
    expect(fingerprintVerses(verses)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps verse numbers, a word count, and the passage ID, but no text", () => {
    const p = providerPayload([v(3, 16, "For God so loved the world."), v(3, 17, "Another verse here.")], { book: "JHN", sc: 3, sv: 16, ec: 3, ev: 17 });
    expect(p).toEqual({ fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), verses: [[3, 16], [3, 17]], words: 9, passage_id: "JHN.3.16-JHN.3.17" });
    expect(JSON.stringify(p)).not.toMatch(/loved|Another/);
  });

  it("lists verses the versions number differently", () => {
    expect(verseDifferences([[8, 36], [8, 38]], [[8, 36], [8, 37], [8, 38]])).toEqual({ only_current: [], only_new: ["8:37"] });
  });
});

describe("fetching a licensed memory passage on the server", () => {
  const translation = { id: "11111111-1111-1111-1111-111111111111", code: "LIC", name: "Licensed", source_kind: "api", text_version: 0 };
  const supabase = (kind: "api" | "database", error: { code: string; message: string } | null = null) =>
    ({
      rpc: async () => ({
        data: error ? null : { translation: { ...translation, source_kind: kind }, provider: { provider: "api_bible", ref: "abc", credential_env: "TEST_MEMORY_KEY", cache_days: null } },
        error,
      }),
    }) as unknown as SupabaseClient;
  const ref = { book: "JHN", sc: 3, sv: 16, ec: 3, ev: 17 };
  const ok: Fetcher = async () => ({
    status: 200,
    headers: {},
    body: Buffer.from(JSON.stringify({ data: { content: "[16] Synthetic sixteen. [17] Synthetic seventeen.", copyright: "Synthetic ©" }, meta: { fumsId: "fums-1" } })),
  }) as unknown as Awaited<ReturnType<Fetcher>>;
  const down: Fetcher = async () => ({ status: 503, headers: {}, body: Buffer.from("") }) as unknown as Awaited<ReturnType<Fetcher>>;

  beforeEach(() => {
    process.env.TEST_MEMORY_KEY = "test-key";
    clearTextCache();
  });
  afterEach(() => {
    delete process.env.TEST_MEMORY_KEY;
  });

  it("returns the text to show, its copyright and FUMS id, and what the database keeps", async () => {
    const r = await fetchMemoryText(supabase("api"), translation.id, ref, ok);
    expect(r).toMatchObject({ status: "ok", copyright: "Synthetic ©", fumsId: "fums-1", payload: { verses: [[3, 16], [3, 17]], words: 4, passage_id: "JHN.3.16-JHN.3.17" } });
    if (r.status === "ok") expect(r.payload.fingerprint).toBe(fingerprintVerses(r.verses));
  });

  it("says practice is temporarily unavailable when the service is down, never using another version", async () => {
    const r = await fetchMemoryText(supabase("api"), translation.id, ref, down);
    expect(r).toEqual({ status: "unavailable", message: expect.stringMatching(/LIC is temporarily unavailable.*no other version is used/) });
  });

  it("leaves stored-text versions to the database, and passes reference problems through", async () => {
    expect(await fetchMemoryText(supabase("database"), translation.id, ref, ok)).toEqual({ status: "stored" });
    expect(await fetchMemoryText(supabase("api", { code: "22023", message: "That verse doesn't exist in this translation." }), translation.id, ref, ok)).toEqual({
      status: "problem",
      message: "That verse doesn't exist in this translation.",
    });
  });
});
