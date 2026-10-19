import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pdfSafe, renderStatementPdf, statementIsFinal, type StatementData } from "./statement-pdf";

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

const logo = new Uint8Array(readFileSync(path.resolve(import.meta.dirname, "../../../public/brand/the-gathering-logo.png")));

describe("annual statement PDF", () => {
  it("stays a draft until identity and wording are approved", () => {
    expect(statementIsFinal(base)).toBe(false);
    expect(statementIsFinal({ ...base, approved: true, org_name: "Org", wording: "" })).toBe(false);
    expect(statementIsFinal({ ...base, approved: true, org_name: "Org", wording: "Approved wording" })).toBe(true);
  });

  it("renders a multi-page PDF with the logo", async () => {
    const bytes = await renderStatementPdf(base, logo, "2026-01-05");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("handles characters outside the PDF font's range", async () => {
    expect(pdfSafe("José “Joe” Ñúñez — 李")).toBe('José "Joe" Ñúñez - ?');
    const bytes = await renderStatementPdf({ ...base, donor_name: "李 Synthetic", approved: true, org_name: "Org", wording: "Wording" }, null, "2026-01-05");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
