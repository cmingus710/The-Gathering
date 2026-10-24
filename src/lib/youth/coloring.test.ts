import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRUSHES,
  HISTORY_LIMIT,
  LIMITS,
  PALETTE,
  addStroke,
  checkDoc,
  checkTemplate,
  coloringStatusLabel,
  decodePoints,
  docTooLarge,
  emptyDoc,
  encodePoints,
  fillRegion,
  historyPush,
  historyRedo,
  historyStart,
  historyUndo,
  lineArtPath,
  parseDoc,
  serializeDoc,
  storedSize,
  templateFromConfig,
  type ColoringTemplate,
} from "./coloring";
import { COLORING_PREFIX, SIGNED_OUT_KEY, coloringKey, purgeColoringDrafts, readColoringDraft, reconcileColoring, writeColoringDraft } from "./coloring-local";

const t: ColoringTemplate = {
  format: 1,
  mode: "regions",
  width: 1000,
  height: 750,
  regions: [
    { id: "r1", label: "Sky", d: "M0 0L1000 0L1000 400L0 400Z", rule: "nonzero", w: 4 },
    { id: "r2", label: "Hill", d: "M0 400L1000 400L1000 750L0 750Z", rule: "nonzero", w: 4 },
  ],
  lines: [{ d: "M10 10L20 20", w: 3 }],
  story: "A synthetic story.",
  attribution: { source_kind: "original", credit: "", license: "", source_url: null },
};

describe("coloring model", () => {
  it("has 12 labeled colors and three brush sizes, matching the database palette", () => {
    expect(PALETTE).toHaveLength(12);
    expect(new Set(PALETTE.map((c) => c.label)).size).toBe(12);
    expect(BRUSHES.map((b) => b.label)).toEqual(["Small", "Medium", "Large"]);
    const sql = readFileSync(path.join(__dirname, "../../../supabase/migrations/20261123000100_youth_coloring.sql"), "utf8");
    const keys = /select array\[([^\]]+)\];/.exec(sql)![1].match(/'([a-z]+)'/g)!.map((k) => k.slice(1, -1));
    expect(keys).toEqual(PALETTE.map((c) => c.key));
  });

  it("fills, draws, undoes, redoes, and starts over through one history", () => {
    let h = historyStart(emptyDoc());
    h = historyPush(h, fillRegion(h.present, "r1", "sky"));
    h = historyPush(h, addStroke(h.present, { t: "paint", c: "red", s: "m", p: "1,1 5,5" }));
    h = historyPush(h, addStroke(h.present, { t: "erase", s: "l", p: "3,3" }));
    expect(h.present.fills).toEqual({ r1: "sky" });
    expect(h.present.strokes).toHaveLength(2);
    h = historyUndo(h);
    expect(h.present.strokes).toHaveLength(1);
    h = historyUndo(h);
    expect(h.present.strokes).toHaveLength(0);
    expect(h.present.fills).toEqual({ r1: "sky" });
    h = historyRedo(h);
    expect(h.present.strokes).toHaveLength(1);
    // Start over is itself undoable.
    h = historyPush(h, emptyDoc());
    expect(h.present).toEqual(emptyDoc());
    h = historyUndo(h);
    expect(h.present.fills).toEqual({ r1: "sky" });
    // A new edit drops the redo branch.
    h = historyPush(historyUndo(h), fillRegion(h.present, "r2", "green"));
    expect(h.future).toEqual([]);
    expect(historyRedo(h)).toBe(h);
    expect(historyUndo(historyStart(emptyDoc())).past).toEqual([]);
  });

  it("keeps a bounded history and ignores edits that change nothing", () => {
    let h = historyStart(emptyDoc());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = historyPush(h, fillRegion(h.present, "r1", i % 2 ? "red" : "blue"));
    expect(h.past.length).toBe(HISTORY_LIMIT);
    const same = fillRegion(h.present, "r1", h.present.fills.r1);
    expect(historyPush(h, same)).toBe(h);
  });

  it("encodes strokes as bounded integer points", () => {
    const p = encodePoints([{ x: 1.2, y: 1.4 }, { x: 1.5, y: 1.5 }, { x: 10.6, y: 20.4 }, { x: 10.7, y: 20.4 }]);
    expect(p).toBe("1,1 11,20");
    expect(decodePoints(p)).toEqual([{ x: 1, y: 1 }, { x: 11, y: 20 }]);
    const long = encodePoints(Array.from({ length: 5000 }, (_, i) => ({ x: i % 900, y: Math.floor(i / 900) * 50 })));
    expect(long.length).toBeLessThanOrEqual(LIMITS.pointsChars);
    expect(encodePoints([{ x: -5000, y: 99999 }])).toBe("-999,1999");
  });

  it("serializes stably so the same picture compares equal", () => {
    const a = { fills: { r2: "red" as const, r10: "blue" as const, r1: "sky" as const }, strokes: [] };
    const b = { fills: { r1: "sky" as const, r10: "blue" as const, r2: "red" as const }, strokes: [] };
    expect(serializeDoc(a)).toBe(serializeDoc(b));
    expect(serializeDoc(a)).toBe('{"fills":{"r1":"sky","r2":"red","r10":"blue"},"strokes":[]}');
    expect(parseDoc(serializeDoc(a), t)).toBeNull(); // r10 isn't a part of this picture
    expect(parseDoc('{"fills":{"r1":"sky"},"strokes":[]}', t)).toEqual({ fills: { r1: "sky" }, strokes: [] });
    expect(parseDoc("not json", t)).toBeNull();
  });

  it("checks artwork against the picture and the palette", () => {
    expect(checkDoc({ fills: { r3: "red" }, strokes: [] }, t)).toMatchObject({ ok: false });
    expect(checkDoc({ fills: { r1: "#f00" }, strokes: [] }, t)).toMatchObject({ ok: false });
    expect(checkDoc({ fills: {}, strokes: [{ t: "paint", c: "red", s: "m", p: "<script>" }] }, t)).toMatchObject({ ok: false });
    expect(checkDoc({ fills: {}, strokes: [{ t: "erase", c: "red", s: "m", p: "1,1" }] }, t)).toMatchObject({ ok: false });
    expect(checkDoc({ fills: {}, strokes: [], extra: 1 }, t)).toMatchObject({ ok: false });
    expect(checkDoc({ fills: { r1: "red" }, strokes: [{ t: "paint", c: "red", s: "s", p: "1,1", r: "r2" }] }, t)).toMatchObject({ ok: true });
  });

  it("never lets a picture grow past what the database stores", () => {
    // The reviewer's case: compact JSON just under the limit, but over it as jsonb::text.
    const pts = (n: number) => Array.from({ length: n }, (_, i) => `${i % 1000},${i % 700}`).join(" ").slice(0, LIMITS.pointsChars);
    let doc = emptyDoc();
    while (!docTooLarge(doc)) doc = addStroke(doc, { t: "paint", c: "red", s: "s", p: pts(1600) });
    const next = addStroke(doc, { t: "paint", c: "red", s: "s", p: pts(1600) });
    expect(next).toBe(doc);
    // Postgres's text form of the largest picture the studio allows still fits.
    expect(storedSize(doc)).toBeLessThanOrEqual(LIMITS.docChars);
    const pgText = serializeDoc(doc).replace(/([:,])/g, "$1 ");
    expect(pgText.length).toBeLessThanOrEqual(LIMITS.docChars);
  });

  it("stops adding strokes when the picture is full", () => {
    const full = { fills: {}, strokes: Array.from({ length: LIMITS.strokes }, () => ({ t: "paint" as const, c: "red" as const, s: "s" as const, p: "1,1" })) };
    expect(docTooLarge(full)).toBe(true);
    expect(addStroke(full, { t: "paint", c: "red", s: "s", p: "2,2" })).toBe(full);
  });

  it("checks pictures the way the database does", () => {
    expect(checkTemplate(t).ok).toBe(true);
    expect(checkTemplate({ ...t, svg: "<svg/>" })).toMatchObject({ ok: false, problem: "has an unsupported field" });
    expect(checkTemplate({ ...t, regions: [{ ...t.regions[0], d: "M0 0 <x>" }] })).toMatchObject({ ok: false });
    expect(checkTemplate({ ...t, regions: [{ ...t.regions[0], label: "<b>Sky</b>" }] })).toMatchObject({ ok: false });
    expect(checkTemplate({ ...t, mode: "freehand" })).toMatchObject({ ok: false });
    expect(templateFromConfig({ coloring: t })).toEqual(t);
    expect(templateFromConfig({ coloring: { ...t, width: 0 } })).toBeNull();
    expect(templateFromConfig({})).toBeNull();
    const free = { ...t, mode: "freehand" as const, regions: [], lines: [], line_art_asset_id: "00000000-0000-4000-8000-000000000001" };
    expect(checkTemplate(free).ok).toBe(true);
    expect(lineArtPath("a1", free)).toBe("activities/a1/00000000-0000-4000-8000-000000000001.webp");
    expect(lineArtPath("a1", t)).toBeNull();
  });

  it("words the save status as Saving, Saved, or Unable to save", () => {
    expect(coloringStatusLabel("saved")).toBe("Saved");
    expect(coloringStatusLabel("saving")).toBe("Saving…");
    expect(coloringStatusLabel("unsaved")).toBe("Saving…");
    expect(coloringStatusLabel("failed")).toBe("Unable to save");
    expect(coloringStatusLabel("offline")).toMatch(/^Unable to save/);
    expect(coloringStatusLabel("conflict")).toMatch(/^Unable to save/);
  });
});

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()];
  }
}

describe("on-device coloring copies", () => {
  it("are scoped by account, child, and version", () => {
    expect(coloringKey("acct", "kid", "ver")).toBe(`${COLORING_PREFIX}:acct:kid:ver`);
    expect(coloringKey("acct", "kidA", "ver")).not.toBe(coloringKey("acct", "kidC", "ver"));
    expect(coloringKey("acct1", "kid", "ver")).not.toBe(coloringKey("acct2", "kid", "ver"));
  });

  it("round-trip and refuse malformed copies", () => {
    const s = new MemoryStorage();
    expect(writeColoringDraft("k", { doc: "{}", base: 2, at: 5 }, s)).toBe(true);
    expect(readColoringDraft("k", s)).toEqual({ doc: "{}", base: 2, at: 5 });
    s.setItem("bad", '{"doc":1,"base":"x"}');
    expect(readColoringDraft("bad", s)).toBeNull();
    s.setItem("worse", "{");
    expect(readColoringDraft("worse", s)).toBeNull();
    expect(writeColoringDraft("k", { doc: "x".repeat(LIMITS.docChars + 1), base: 0, at: 0 }, s)).toBe(false);
    expect(writeColoringDraft("k", { doc: "{}", base: 0, at: 0 }, null)).toBe(false);
  });

  it("are all removed on sign-out, and other accounts' or stale ones when the studio opens", () => {
    const s = new MemoryStorage();
    const now = 1_000_000_000_000;
    writeColoringDraft(coloringKey("me", "kid", "v"), { doc: "{}", base: 0, at: now }, s);
    writeColoringDraft(coloringKey("me", "kid", "old"), { doc: "{}", base: 0, at: now - 31 * 86400000 }, s);
    writeColoringDraft(coloringKey("someone", "kid2", "v"), { doc: "{}", base: 0, at: now }, s);
    s.setItem("player-rate", "1.5");
    s.setItem("gathering.workbook.v1:me:item:note", "{}");
    expect(purgeColoringDrafts({ keepAccount: "me", now }, s)).toBe(2);
    expect(s.keys().sort()).toEqual([coloringKey("me", "kid", "v"), "gathering.workbook.v1:me:item:note", "player-rate"].sort());
    expect(s.keys()).not.toContain(SIGNED_OUT_KEY); // opening a studio doesn't announce a sign-out
    expect(purgeColoringDrafts({ now }, s)).toBe(1);
    // Sign-out also leaves a marker other open tabs hear, so they stop keeping copies.
    expect(s.keys().sort()).toEqual([SIGNED_OUT_KEY, "gathering.workbook.v1:me:item:note", "player-rate"].sort());
    expect(s.getItem(SIGNED_OUT_KEY)).toBe(String(now));
  });

  it("restores a copy made on the saved revision and asks when the saved picture changed since", () => {
    expect(reconcileColoring({ doc: "A", revision: 3 }, null)).toEqual({ kind: "none" });
    expect(reconcileColoring({ doc: "A", revision: 3 }, { doc: "A", base: 1, at: 0 })).toEqual({ kind: "none" });
    expect(reconcileColoring({ doc: "A", revision: 3 }, { doc: "B", base: 3, at: 0 })).toEqual({ kind: "restore", doc: "B" });
    expect(reconcileColoring({ doc: "A", revision: 4 }, { doc: "B", base: 3, at: 0 })).toEqual({ kind: "conflict", doc: "B" });
  });
});
