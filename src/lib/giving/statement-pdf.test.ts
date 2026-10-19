import { readFileSync } from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { winAnsiSafe } from "./pdf-text";
import { renderStatementPdf, statementIsFinal, type StatementData } from "./statement-pdf";

const base: StatementData = {
  year: 2025,
  timezone: "America/Chicago",
  donor_name: "Synthetic Donor",
  donor_email: "donor@example.test",
  items: Array.from({ length: 70 }, (_, i) => ({ date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`, fund_name: "General Offering", method: "Online", amount_cents: 2500 })),
  adjustments: [{ date: "2025-03-01", fund_name: "Missions", description: "Refund", amount_cents: -1000 }],
  gross_cents: 175000,
  adjustments_cents: -1000,
  net_cents: 174000,
  church_name: "The Gathering",
  org_name: null,
  org_address: null,
  tax_id: null,
  wording: null,
  approved: false,
};

const root = path.resolve(import.meta.dirname, "../../..");
const logo = new Uint8Array(readFileSync(path.join(root, "public/brand/the-gathering-logo.png")));
const loaded: string[] = [];
const loadFont = async (file: string) => {
  loaded.push(file);
  return new Uint8Array(readFileSync(path.join(root, "assets/fonts", file)));
};
const noFonts = async () => null;

/** Font names embedded in the PDF (subset fonts are prefixed "ABCDEF+"). */
async function embeddedFonts(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const names = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const base = (obj as { get?: (k: unknown) => unknown }).get?.(doc.context.obj("BaseFont"));
    if (base) names.add(String(base).replace(/^\/([A-Z]{6}\+)?/, ""));
  }
  return [...names].sort();
}

describe("annual statement PDF", () => {
  it("stays a draft until identity and wording are approved", () => {
    expect(statementIsFinal(base)).toBe(false);
    expect(statementIsFinal({ ...base, approved: true, org_name: "Org", wording: "" })).toBe(false);
    expect(statementIsFinal({ ...base, approved: true, org_name: "Org", wording: "Approved wording" })).toBe(true);
  });

  it("renders a multi-page PDF with the logo", async () => {
    const bytes = await renderStatementPdf(base, logo, "2026-01-05", loadFont);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("keeps non-Latin donor names instead of replacing them", async () => {
    loaded.length = 0;
    const names = ["José Ñúñez", "Nguyễn Văn An", "李伟", "陳美玲", "山田 さくら", "김민준", "محمد علي", "דוד כהן", "สมชาย ใจดี", "Анна Петрова", "प्रिया शर्मा"];
    for (const donor_name of names) {
      const bytes = await renderStatementPdf({ ...base, donor_name, items: base.items.slice(0, 2) }, null, "2026-01-05", loadFont);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getSubject()).toBe(`2025 giving statement for ${donor_name}`);
    }
    // Each script used its font; Latin-only statements don't load the large CJK files.
    const fonts = await embeddedFonts(await renderStatementPdf({ ...base, donor_name: "김민준 李伟 محمد" }, null, "2026-01-05", loadFont));
    expect(fonts).toEqual(expect.arrayContaining(["NotoSans", "NotoSansKR-Regular", "NotoSansSC-Regular", "NotoSansArabic-Regular"].map((f) => expect.stringContaining(f.split("-")[0]))));
    loaded.length = 0;
    await renderStatementPdf(base, null, "2026-01-05", loadFont);
    expect(loaded.some((f) => /SC|KR/.test(f))).toBe(false);
  });

  it("embeds subset fonts whose glyphs keep their outlines", async () => {
    const bytes = await renderStatementPdf({ ...base, donor_name: "Synthetic محمد علي" }, null, "2026-01-05", loadFont);
    const doc = await PDFDocument.load(bytes);
    const fontFiles = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => (obj instanceof PDFDict ? obj.get(PDFName.of("FontFile2")) : undefined))
      .filter((ref) => ref !== undefined)
      .map((ref) => doc.context.lookup(ref) as PDFRawStream);
    expect(fontFiles.length).toBeGreaterThanOrEqual(2);
    for (const file of fontFiles) {
      const font = fontkit.create(Buffer.from(decodePDFRawStream(file).decode()));
      const getGlyph = (font as unknown as { getGlyph(id: number): { path: { commands: unknown[] } } }).getGlyph.bind(font);
      let blank = 0;
      for (let id = 1; id < (font.numGlyphs as number); id++) if (!getGlyph(id).path.commands.length) blank++;
      // Only the space is blank (subset fonts carry no glyph names to tell).
      expect(blank).toBeLessThanOrEqual(1);
    }
  });

  it("orders right-to-left runs visually", async () => {
    const { PdfText } = await import("./pdf-text");
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont("Helvetica");
    const pdf = await PdfText.create(doc, ["דוד כהן 123", "Ana דוד"], loadFont, { regular: helv, bold: helv });
    // Hebrew runs are passed in logical order (fontkit reverses them); digits stay left-to-right.
    expect(pdf.runs("Ana דוד", "regular").map((r) => r.text)).toEqual(["Ana ", "דוד"]);
    expect(pdf.runs("דוד כהן 123", "regular").map((r) => r.text)).toEqual(["123", "דוד כהן "]);
  });

  it("still renders when the font files can't be read", async () => {
    expect(winAnsiSafe("José “Joe” Ñúñez — 李")).toBe('José "Joe" Ñúñez - ?');
    const bytes = await renderStatementPdf({ ...base, donor_name: "李 Synthetic", approved: true, org_name: "Org", wording: "Wording" }, null, "2026-01-05", noFonts);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
