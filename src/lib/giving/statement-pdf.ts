import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage, type RGB } from "pdf-lib";
import { formatCents } from "./money";
import { PdfText, type Face, type FontLoader } from "./pdf-text";

export type StatementData = {
  year: number;
  timezone: string;
  donor_name: string | null;
  donor_email: string | null;
  items: Array<{ date: string; fund_name: string; method: string; amount_cents: number }>;
  adjustments: Array<{ date: string; fund_name: string; description: string; amount_cents: number }>;
  gross_cents: number;
  adjustments_cents: number;
  net_cents: number;
  church_name: string | null;
  org_name: string | null;
  org_address: string | null;
  tax_id: string | null;
  wording: string | null;
  approved: boolean;
};

/** The statement is release-ready only once identity and wording are approved. */
export function statementIsFinal(d: Pick<StatementData, "approved" | "org_name" | "wording">): boolean {
  return d.approved && !!d.org_name?.trim() && !!d.wording?.trim();
}

const INK = rgb(0.21, 0.2, 0.19);
const MUTED = rgb(0.44, 0.42, 0.38);
const GOLD = rgb(0.68, 0.55, 0.33);

/** Shortens to `max` characters without splitting a surrogate pair. */
const clip = (s: string, max: number) => Array.from(s).slice(0, max).join("");

function wrap(text: string, pdf: PdfText, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (pdf.width(next, size, "regular") > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/**
 * Annual giving statement. Itemizes received gifts, lists refunds and
 * reversals as adjustments, and totals them. Until finance has entered and
 * approved the organization identity and acknowledgment wording, the PDF is
 * watermarked DRAFT and carries no acknowledgment language.
 *
 * Names and other entered text keep their original characters in any
 * script the bundled fonts cover (`loadFont` reads files from
 * assets/fonts). The donor name is also stored in the PDF metadata, which
 * is plain Unicode.
 */
export async function renderStatementPdf(
  d: StatementData,
  logoPng: Uint8Array | null,
  generatedOn: string,
  loadFont: FontLoader,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const orgName = d.org_name?.trim() || d.church_name || "The Gathering";
  const donor = d.donor_name?.trim() || "Donor";
  doc.setTitle(`${d.year} giving statement`);
  doc.setSubject(`${d.year} giving statement for ${donor}`);
  doc.setAuthor(orgName);
  doc.setCreator("The Gathering");
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const strings = [
    orgName,
    donor,
    d.org_address ?? "",
    d.tax_id ?? "",
    d.wording ?? "",
    d.timezone,
    ...d.items.flatMap((i) => [i.fund_name, i.method]),
    ...d.adjustments.flatMap((a) => [a.fund_name, a.description]),
  ];
  const pdf = await PdfText.create(doc, strings, loadFont, { regular: helvetica, bold: helveticaBold });
  const final = statementIsFinal(d);
  const logo = logoPng ? await doc.embedPng(logoPng).catch(() => null) : null;

  const W = 612;
  const H = 792;
  const M = 54;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const drawAt = (p: PDFPage, s: string, x: number, yy: number, size: number, face: Face, color: RGB) =>
    pdf.draw(p, s, { x, y: yy, size, face, color });
  const text = (s: string, x: number, size = 10, face: Face = "regular", color = INK) => drawAt(page, s, x, y, size, face, color);
  const right = (s: string, xRight: number, size = 10, face: Face = "regular") =>
    drawAt(page, s, xRight - pdf.width(s, size, face), y, size, face, INK);
  const watermark = () => {
    if (final) return;
    page.drawText("DRAFT", { x: 150, y: 330, size: 120, font: helveticaBold, color: rgb(0.85, 0.82, 0.76), opacity: 0.45, rotate: degrees(30) });
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    watermark();
    y = H - M;
  };
  const need = (h: number) => {
    if (y - h < M + 40) newPage();
  };
  watermark();

  // Header
  if (logo) {
    const scale = 70 / logo.height;
    page.drawImage(logo, { x: M, y: y - 70, width: logo.width * scale, height: 70 });
  }
  y -= 14;
  right(orgName, W - M, 12, "bold");
  for (const line of (d.org_address ?? "").split("\n").filter(Boolean)) {
    y -= 14;
    right(line, W - M, 9);
  }
  if (d.tax_id) {
    y -= 14;
    right(`Tax ID: ${d.tax_id}`, W - M, 9);
  }
  y = Math.min(y, H - M - 70) - 36;

  text(`${d.year} Giving Statement`, M, 18, "bold");
  y -= 22;
  text(`Prepared for ${donor}`, M, 11);
  y -= 14;
  text(`Period: January 1 - December 31, ${d.year} (${d.timezone})`, M, 9, "regular", MUTED);
  y -= 26;

  if (!final) {
    page.drawRectangle({ x: M, y: y - 28, width: W - 2 * M, height: 36, color: rgb(1, 0.96, 0.84), borderColor: GOLD, borderWidth: 1 });
    y -= 6;
    text("DRAFT - not for distribution.", M + 10, 10, "bold");
    y -= 14;
    text("The church's organization details and acknowledgment wording have not been approved yet.", M + 10, 9);
    y -= 28;
  }

  const cols = { date: M, fund: M + 90, method: M + 300, amount: W - M };
  const header = (title: string) => {
    need(40);
    text(title, M, 11, "bold");
    y -= 16;
    text("Date", cols.date, 9, "bold", MUTED);
    text("Fund", cols.fund, 9, "bold", MUTED);
    text(title === "Gifts received" ? "Method" : "Description", cols.method, 9, "bold", MUTED);
    right("Amount", cols.amount, 9, "bold");
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: MUTED });
    y -= 14;
  };

  header("Gifts received");
  if (!d.items.length) {
    text("No gifts were received in this period.", M, 10, "regular", MUTED);
    y -= 16;
  }
  for (const item of d.items) {
    need(16);
    text(item.date, cols.date);
    text(clip(item.fund_name, 40), cols.fund);
    text(item.method, cols.method);
    right(formatCents(item.amount_cents).replace("−", "-"), cols.amount);
    y -= 15;
  }

  if (d.adjustments.length) {
    y -= 10;
    header("Refunds and adjustments");
    for (const a of d.adjustments) {
      need(16);
      text(a.date, cols.date);
      text(clip(a.fund_name, 40), cols.fund);
      text(a.description, cols.method);
      right(formatCents(a.amount_cents).replace("−", "-"), cols.amount);
      y -= 15;
    }
  }

  y -= 10;
  need(60);
  page.drawLine({ start: { x: W - M - 220, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: MUTED });
  y -= 8;
  const total = (label: string, cents: number, face: Face = "regular") => {
    text(label, W - M - 220, 10, face);
    right(formatCents(cents).replace("−", "-"), W - M, 10, face);
    y -= 15;
  };
  total("Gifts received", d.gross_cents);
  total("Refunds and adjustments", d.adjustments_cents);
  total("Total", d.net_cents, "bold");

  if (final && d.wording) {
    y -= 16;
    for (const line of wrap(d.wording, pdf, 9.5, W - 2 * M)) {
      need(14);
      text(line, M, 9.5);
      y -= 13;
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    drawAt(p, `Generated ${generatedOn} - Page ${i + 1} of ${pages.length}`, M, M - 20, 8, "regular", MUTED);
  });
  return doc.save();
}
