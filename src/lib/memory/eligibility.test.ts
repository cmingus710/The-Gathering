import { describe, expect, it } from "vitest";
import { memoryEligibility, providerAccessConfigured, unavailableNote, versionChoices, type MemoryOption } from "./eligibility";

const option = (over: Partial<MemoryOption>): MemoryOption => ({
  id: "00000000-0000-0000-0000-000000000001",
  code: "WEB",
  name: "World English Bible",
  language: "en",
  source_kind: "database",
  attribution: "",
  copyright: "",
  source_url: null,
  allow_copy: false,
  allow_print: false,
  allow_export: false,
  max_verses_per_view: 500,
  tracking_required: false,
  text_version: 1,
  memory_modes: ["read_repeat", "flashcards", "missing_words", "word_order", "type_verse", "self_check"],
  memory_eligible: true,
  memory_reason: null,
  credential_env: null,
  ...over,
});
const licensed = (code: string, over: Partial<MemoryOption> = {}) =>
  option({ id: `00000000-0000-0000-0000-0000000000${code.length}${code.charCodeAt(0)}`, code, name: `${code} licensed`, source_kind: "api", memory_modes: ["flashcards", "self_check"], credential_env: "API_BIBLE_KEY", tracking_required: true, ...over });

const configured = { API_BIBLE_KEY: "synthetic-key" };

describe("memory version eligibility (shared rule)", () => {
  it("keeps stored-text versions available", () => {
    expect(memoryEligibility(option({}), {})).toEqual({ eligible: true, reason: null });
  });

  it("offers permitted NIV, NASB, and AMP only when their key is configured here", () => {
    for (const code of ["NIV", "NASB", "AMP"]) {
      expect(memoryEligibility(licensed(code), configured)).toEqual({ eligible: true, reason: null });
      expect(memoryEligibility(licensed(code), {})).toEqual({ eligible: false, reason: "not_configured" });
    }
  });

  it("never lets publication alone bypass the memory permission", () => {
    const published = licensed("NIV", { memory_eligible: false, memory_reason: "not_confirmed", memory_modes: [] });
    expect(memoryEligibility(published, configured)).toEqual({ eligible: false, reason: "not_confirmed" });
  });

  it("accepts only API.Bible hosts and well-formed setting names", () => {
    expect(providerAccessConfigured("API_BIBLE_KEY", configured)).toBe(true);
    expect(providerAccessConfigured("API_BIBLE_KEY", { ...configured, API_BIBLE_BASE_URL: "https://example.test/v1" })).toBe(false);
    expect(providerAccessConfigured("lowercase", { lowercase: "x" })).toBe(false);
    expect(providerAccessConfigured(null, configured)).toBe(false);
  });

  it("lists ineligible published versions with a specific reason instead of dropping them", () => {
    const list = versionChoices(
      [option({}), licensed("NIV"), licensed("NASB", { memory_eligible: false, memory_reason: "not_confirmed", memory_modes: [] }), licensed("AMP", { credential_env: "AMP_KEY" })],
      configured,
    );
    expect(list.map((t) => [t.code, t.eligible, t.reason])).toEqual([
      ["WEB", true, null],
      ["NIV", true, null],
      ["NASB", false, "not_confirmed"],
      ["AMP", false, "not_configured"],
    ]);
    expect(list[2].note).toMatch(/NASB isn't confirmed for memory verses/);
    expect(list[3].note).toMatch(/AMP isn't connected to API.Bible/);
    expect(list[1]).toMatchObject({ licensed: true, modes: ["flashcards", "self_check"] });
  });

  it("explains a collection version that's unavailable now, or no longer published", () => {
    const niv = licensed("NIV");
    expect(unavailableNote([niv], niv.id, "NIV", configured)).toBeNull();
    expect(unavailableNote([niv], niv.id, "NIV", {})).toMatch(/isn't connected/);
    expect(unavailableNote([], niv.id, "NIV", configured)).toMatch(/isn't published/);
  });
});
