import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiBibleBase, apiBiblePassageId, apiBiblePassageUrl, parseApiBiblePassage } from "./api-bible";
import { clearTextCache, resolveText, type Fetcher } from "./source";
import type { ProviderConfig } from "./types";

/**
 * The API adapter is tested only against recorded response shapes. This
 * proves request building, parsing, error handling, key handling, and
 * caching rules; it does not prove the live service works (see
 * docs/bible-sources.md).
 */
const provider: ProviderConfig = { provider: "api_bible", ref: "de4e12af7f28f599-02", credential_env: "TEST_API_BIBLE_KEY", cache_days: null };
const tr = { id: "11111111-1111-1111-1111-111111111111", text_version: 0 };
const range = { book: "JHN", sc: 3, sv: 16, ec: 3, ev: 17 };
const body = (content: string) => Buffer.from(JSON.stringify({ data: { content, copyright: "Synthetic copyright notice" }, meta: { fumsId: "fums-123" } }));

describe("API.Bible requests and parsing", () => {
  it("builds passage ids and only https URLs on the provider's hosts", () => {
    expect(apiBiblePassageId("JHN", 3, 16, 3, 21)).toBe("JHN.3.16-JHN.3.21");
    expect(apiBiblePassageId("PSA", 23, null, 23, null)).toBe("PSA.23");
    expect(apiBiblePassageId("GEN", 1, null, 2, null)).toBe("GEN.1-GEN.2");
    expect(apiBibleBase(undefined)).toBe("https://rest.api.bible/v1");
    expect(apiBibleBase("https://api.scripture.api.bible/v1/")).toBe("https://api.scripture.api.bible/v1");
    expect(apiBibleBase("http://rest.api.bible/v1")).toBeNull();
    expect(apiBibleBase("https://169.254.169.254/v1")).toBeNull();
    expect(apiBibleBase("https://rest.api.bible.evil.example/v1")).toBeNull();
    expect(apiBibleBase("https://user:pw@rest.api.bible/v1")).toBeNull();
    expect(() => apiBiblePassageUrl("https://rest.api.bible/v1", "../x", "JHN.3.16")).toThrow();
    expect(apiBiblePassageUrl("https://rest.api.bible/v1", "abc", "JHN.3.16")).toContain("/bibles/abc/passages/JHN.3.16?content-type=text");
  });

  it("splits verses at the provider's markers, across chapters, without changing words", () => {
    const r = parseApiBiblePassage(JSON.parse(body("     [16] Synthetic sixteen.  [17] Synthetic seventeen. [1] Next chapter.").toString()), "JHN", 3);
    expect(r.verses.map((v) => [v.c, v.v, v.t])).toEqual([[3, 16, "Synthetic sixteen."], [3, 17, "Synthetic seventeen."], [4, 1, "Next chapter."]]);
    expect(r).toMatchObject({ copyright: "Synthetic copyright notice", fumsId: "fums-123" });
    expect(() => parseApiBiblePassage({ data: {} }, "JHN", 3)).toThrow();
    expect(() => parseApiBiblePassage({ data: { content: "no markers" } }, "JHN", 3)).toThrow(/no verses/);
  });
});

describe("resolveText", () => {
  beforeEach(() => {
    process.env.TEST_API_BIBLE_KEY = "synthetic-key";
    delete process.env.API_BIBLE_BASE_URL;
    clearTextCache();
  });
  afterEach(() => {
    delete process.env.TEST_API_BIBLE_KEY;
  });

  it("returns stored text as is", async () => {
    const verses = [{ c: 3, v: 16, t: "x", o: false, h: null, p: false, q: false }];
    expect(await resolveText(tr, verses, null, range)).toEqual({ status: "ok", verses, fumsId: null, copyright: null });
  });

  it("sends the key only to the provider, server side", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ({ status: 200, url: "", headers: {}, body: body("[16] A. [17] B.") }));
    const r = await resolveText(tr, null, provider, range, fetcher);
    expect(r.status).toBe("ok");
    const [url, opts] = fetcher.mock.calls[0];
    expect(url).toMatch(/^https:\/\/rest\.api\.bible\/v1\/bibles\/de4e12af7f28f599-02\/passages\/JHN\.3\.16-JHN\.3\.17\?/);
    expect(url).not.toContain("synthetic-key");
    expect(opts).toMatchObject({ headers: { "api-key": "synthetic-key" }, maxRedirects: 0 });
  });

  it("reports outages and missing configuration honestly, with no substitute text", async () => {
    const down = vi.fn<Fetcher>(async () => ({ status: 503, url: "", headers: {}, body: Buffer.from("") }));
    expect(await resolveText(tr, null, provider, range, down)).toEqual({ status: "unavailable", reason: "outage" });
    const thrown = vi.fn<Fetcher>(async () => Promise.reject(new Error("timeout")));
    expect(await resolveText(tr, null, provider, range, thrown)).toEqual({ status: "unavailable", reason: "outage" });
    const garbage = vi.fn<Fetcher>(async () => ({ status: 200, url: "", headers: {}, body: Buffer.from("<html>") }));
    expect(await resolveText(tr, null, provider, range, garbage)).toEqual({ status: "unavailable", reason: "outage" });
    const denied = vi.fn<Fetcher>(async () => ({ status: 401, url: "", headers: {}, body: Buffer.from("{}") }));
    expect(await resolveText(tr, null, provider, range, denied)).toEqual({ status: "unavailable", reason: "not_configured" });
    delete process.env.TEST_API_BIBLE_KEY;
    expect(await resolveText(tr, null, provider, range, down)).toEqual({ status: "unavailable", reason: "not_configured" });
    expect(await resolveText(tr, null, null, range)).toEqual({ status: "unavailable", reason: "not_configured" });
  });

  it("caches only when the translation allows it, keyed by translation and text version", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ({ status: 200, url: "", headers: {}, body: body("[16] A. [17] B.") }));
    await resolveText(tr, null, provider, range, fetcher);
    await resolveText(tr, null, provider, range, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2); // not allowed: no cache
    const cached = { ...provider, cache_days: 7 };
    await resolveText(tr, null, cached, range, fetcher);
    await resolveText(tr, null, cached, range, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await resolveText({ ...tr, id: "22222222-2222-2222-2222-222222222222" }, null, cached, range, fetcher);
    await resolveText({ ...tr, text_version: 1 }, null, cached, range, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(5); // another translation or version never reuses it
  });
});
