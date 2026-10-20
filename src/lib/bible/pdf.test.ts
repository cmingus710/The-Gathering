import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfError, inspectPdf, looksLikePdf } from "./pdf";

async function textPdf(pages: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage().drawText("Synthetic page", { x: 50, y: 700, font, size: 12 });
  return doc.save();
}

// A one-pixel PNG drawn on the page, like a scanned page without a text layer.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function scannedPdf() {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(PIXEL);
  doc.addPage().drawImage(img, { x: 0, y: 0, width: 600, height: 800 });
  return doc.save();
}

describe("inspectPdf", () => {
  it("counts pages and detects a text layer", async () => {
    expect(await inspectPdf(await textPdf(3))).toEqual({ pages: 3, textLayer: "present", encrypted: false });
  });

  it("recognizes image-only (scanned) pages", async () => {
    expect((await inspectPdf(await scannedPdf())).textLayer).toBe("absent");
  });

  it("refuses files that aren't PDFs, or are damaged", async () => {
    await expect(inspectPdf(Buffer.from("<html>not a pdf</html>"))).rejects.toThrow(PdfError);
    await expect(inspectPdf(Buffer.from("%PDF-1.7\n garbage"))).rejects.toThrow(/couldn't be read|no pages/);
    expect(looksLikePdf(Buffer.from("%PDF-1.4"))).toBe(true);
  });
});
