import { PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject } from "pdf-lib";

/**
 * Inspection of an uploaded Bible PDF (an untrusted file). The PDF is kept
 * only as an administrators' reference: no text is extracted from it, and
 * nothing in it is executed or rendered on the server. Inspection checks
 * the signature, size, and page count, and estimates whether pages carry
 * selectable text (fonts) or are scanned images, so the reference list can
 * say which kind of document it is.
 *
 * Why no extraction: Bible PDFs lay text out for print (columns, footnotes,
 * cross-references, drop-cap chapter numbers, running heads), and verse
 * boundaries can't be recovered reliably from positioned glyphs; scanned
 * pages would need OCR, which guesses. Member-facing text comes from the
 * structured import (CSV/TSV/VPL) or a licensed API instead
 * (docs/bible-sources.md).
 */
export const PDF_MAX_BYTES = 50 * 1024 * 1024;
export const PDF_MAX_PAGES = 20_000;
const PAGES_SAMPLED = 300;

export type PdfInspection = { pages: number; textLayer: "present" | "absent" | "mixed" | "unknown"; encrypted: boolean };

export class PdfError extends Error {}

export function looksLikePdf(head: Uint8Array): boolean {
  const s = Buffer.from(head.subarray(0, 1024)).toString("latin1");
  return s.includes("%PDF-");
}

function dictOf(doc: PDFDocument, obj: PDFObject | undefined): PDFDict | null {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (v instanceof PDFStream) return v.dict;
  return v instanceof PDFDict ? v : null;
}

function hasEntries(doc: PDFDocument, obj: PDFObject | undefined): boolean {
  const d = dictOf(doc, obj);
  return !!d && d.keys().length > 0;
}

function hasImage(doc: PDFDocument, xobjects: PDFDict | null): boolean {
  if (!xobjects) return false;
  for (const key of xobjects.keys()) {
    const x = dictOf(doc, xobjects.get(key));
    if (x?.get(PDFName.of("Subtype"))?.toString() === "/Image") return true;
  }
  return false;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  if (bytes.byteLength > PDF_MAX_BYTES) throw new PdfError("The PDF is larger than 50 MB.");
  if (!looksLikePdf(bytes)) throw new PdfError("This file isn't a PDF.");
  let doc: PDFDocument;
  let pages: number;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    pages = doc.getPageCount();
  } catch {
    throw new PdfError("The PDF couldn't be read. It may be damaged.");
  }
  if (pages < 1) throw new PdfError("The PDF has no pages.");
  if (pages > PDF_MAX_PAGES) throw new PdfError(`The PDF has more than ${PDF_MAX_PAGES} pages.`);
  if (doc.isEncrypted) return { pages, textLayer: "unknown", encrypted: true };
  let text = 0;
  let scanned = 0;
  try {
    for (const page of doc.getPages().slice(0, PAGES_SAMPLED)) {
      const resources = page.node.Resources() ?? null;
      if (!resources) continue;
      const fonts = hasEntries(doc, resources.get(PDFName.of("Font")));
      const images = hasImage(doc, dictOf(doc, resources.get(PDFName.of("XObject"))));
      if (fonts) text++;
      else if (images) scanned++;
    }
  } catch {
    return { pages, textLayer: "unknown", encrypted: false };
  }
  const textLayer = text && !scanned ? "present" : scanned && !text ? "absent" : text && scanned ? "mixed" : "unknown";
  return { pages, textLayer, encrypted: false };
}

