import { describe, expect, it } from "vitest";
import {
  checkScriptureRef,
  clearDraft,
  draftKey,
  readDraft,
  reconcileDraft,
  scripturePassages,
  workbookStatusLabel,
  writeDraft,
} from "./workbook";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

describe("scripture blocks", () => {
  it("turns canonical references into passages", () => {
    expect(scripturePassages("John 3:16–18")).toEqual([{ book: "JHN", sc: 3, sv: 16, ec: 3, ev: 18 }]);
    expect(scripturePassages("Psalms 23")).toEqual([{ book: "PSA", sc: 23, sv: null, ec: 23, ev: null }]);
    expect(scripturePassages("jn 3:16-18, 21")).toEqual([
      { book: "JHN", sc: 3, sv: 16, ec: 3, ev: 18 },
      { book: "JHN", sc: 3, sv: 21, ec: 3, ev: 21 },
    ]);
  });

  it("returns null for references it can't read", () => {
    expect(scripturePassages(null)).toBeNull();
    expect(scripturePassages("Hezekiah 4:1")).toBeNull();
    expect(scripturePassages("John 99:1")).toBeNull();
  });

  it("validates builder input and returns the canonical form", () => {
    expect(checkScriptureRef("1 cor 13")).toEqual({ ok: true, ref: "1 Corinthians 13" });
    expect(checkScriptureRef("jn 3:16-18")).toEqual({ ok: true, ref: "John 3:16–18" });
    expect(checkScriptureRef("not a verse").ok).toBe(false);
    const r = checkScriptureRef("John 30:1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/21 chapters/);
  });
});

describe("autosave wording", () => {
  it("uses the workbook's status text", () => {
    expect(workbookStatusLabel({ status: "saving" })).toBe("Saving…");
    expect(workbookStatusLabel({ status: "saved" })).toBe("Saved");
    for (const status of ["failed", "offline", "retrying"] as const) {
      expect(workbookStatusLabel({ status })).toBe("Couldn't save — your text is kept here, retrying");
    }
    expect(workbookStatusLabel({ status: "conflict" })).toMatch(/choose/);
  });
});

describe("on-device drafts", () => {
  it("keys drafts by member, lesson, and block", () => {
    expect(draftKey("u1", "i1", "b1")).toBe("gathering.workbook.v1:u1:i1:b1");
    expect(draftKey("u2", "i1", "b1")).not.toBe(draftKey("u1", "i1", "b1"));
  });

  it("writes, reads, and clears", () => {
    const s = memoryStorage();
    const key = draftKey("u", "i", "b");
    expect(readDraft(key, s)).toBeNull();
    writeDraft(key, { text: "hello", base: 2, at: 5 }, s);
    expect(readDraft(key, s)).toEqual({ text: "hello", base: 2, at: 5 });
    clearDraft(key, s);
    expect(readDraft(key, s)).toBeNull();
    expect(s.size()).toBe(0);
  });

  it("ignores malformed or missing storage", () => {
    const s = memoryStorage();
    s.setItem("k", "{not json");
    expect(readDraft("k", s)).toBeNull();
    s.setItem("k", JSON.stringify({ text: 3, base: 1 }));
    expect(readDraft("k", s)).toBeNull();
    s.setItem("k", JSON.stringify({ text: "x", base: -1 }));
    expect(readDraft("k", s)).toBeNull();
    expect(readDraft("k", null)).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readDraft("k", throwing)).toBeNull();
    expect(() => writeDraft("k", { text: "x", base: 0, at: 0 }, throwing)).not.toThrow();
    expect(() => clearDraft("k", throwing)).not.toThrow();
  });

  it("restores a copy written on the saved version, and never silently overwrites newer text", () => {
    expect(reconcileDraft({ body: "saved", version: 3 }, null)).toEqual({ kind: "none" });
    expect(reconcileDraft({ body: "same", version: 3 }, { text: "same", base: 1, at: 0 })).toEqual({ kind: "none" });
    expect(reconcileDraft({ body: "saved", version: 3 }, { text: "typed offline", base: 3, at: 0 })).toEqual({ kind: "restore", text: "typed offline" });
    expect(reconcileDraft({ body: "newer elsewhere", version: 4 }, { text: "typed offline", base: 3, at: 0 })).toEqual({
      kind: "conflict",
      text: "typed offline",
    });
    // A first answer typed offline while nothing is saved yet.
    expect(reconcileDraft({ body: "", version: 0 }, { text: "first", base: 0, at: 0 })).toEqual({ kind: "restore", text: "first" });
  });
});
