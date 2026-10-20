import { readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parsePlanCsv, parsePlanXlsx, planTemplate, planTemplateXlsx, PLAN_IMPORT_LIMITS } from "./plan-import";
import { excelSerialToYmd, isDateFormat, readXlsxTable } from "./xlsx";

/**
 * Excel imports. The fixtures were written by real spreadsheet software:
 * openpyxl (dates displayed m/d/yyyy, a blank row, a second sheet; and a
 * 1904-date-system workbook shown as d-mmm-yy) and LibreOffice converting
 * CSVs typed with US dates (11/1/2027), as Excel would store them.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../../../tests/fixtures/bible", name)));
const summary = (r: ReturnType<typeof parsePlanXlsx>) => r.rows.map((x) => [x.row, x.day_date ?? x.day_number, x.kind, x.labels.join("; ")]);

/** A minimal workbook around a raw sheet (and optional shared strings, styles, workbook properties). */
function workbook(sheet: string, extra: { shared?: string; styles?: string; workbookPr?: string } = {}): Uint8Array {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<workbook ${ns} xmlns:r="${rel}">${extra.workbookPr ?? ""}<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/data.xml"/></Relationships>`),
    "xl/worksheets/data.xml": strToU8(`<worksheet ${ns}><sheetData>${sheet}</sheetData></worksheet>`),
  };
  if (extra.shared) files["xl/sharedStrings.xml"] = strToU8(`<sst ${ns}>${extra.shared}</sst>`);
  if (extra.styles) files["xl/styles.xml"] = strToU8(`<styleSheet ${ns}>${extra.styles}</styleSheet>`);
  return zipSync(files);
}
const str = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;

describe("Excel reading plan import", () => {
  it("reads a dated plan typed in Excel: date cells, the first sheet only, blank rows skipped, Excel row numbers", () => {
    const r = parsePlanXlsx(fixture("plan-dated-openpyxl.xlsx"), "calendar");
    expect(r.errors).toEqual([]);
    expect(summary(r)).toEqual([
      [2, "2027-11-01", "reading", "John 1"],
      [3, "2027-11-02", "reading", "John 2; Psalm 23"],
      [5, "2027-11-03", "rest", ""],
    ]);
    expect(r.rows[0].heading).toBe("The Word became flesh");
    expect(r.rows[0].questions).toEqual(["What does verse 14 tell you?", "Which verse stood out?"]);
  });

  it("converts US-style dates from their stored value, never their display (LibreOffice)", () => {
    const r = parsePlanXlsx(fixture("plan-dated-libreoffice.xlsx"), "calendar");
    expect(r.errors).toEqual([]);
    expect(summary(r)).toEqual([
      [2, "2027-11-01", "reading", "Genesis 1–2"],
      [3, "2027-11-02", "reading", "Psalm 1"],
    ]);
  });

  it("handles the 1904 date system and leap days", () => {
    const r = parsePlanXlsx(fixture("plan-dated-1904.xlsx"), "calendar");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.day_date)).toEqual(["2027-02-28", "2028-02-29"]);
  });

  it("reads numbered days as whole numbers, with notes containing commas", () => {
    const r = parsePlanXlsx(fixture("plan-numbered-libreoffice.xlsx"), "personal");
    expect(r.errors).toEqual([]);
    expect(summary(r)).toEqual([
      [2, 1, "reading", "John 1"],
      [3, 2, "reading", "John 2:1–11; Psalm 23"],
      [4, 3, "reading", "John 3"],
    ]);
    expect(r.rows[1].notes).toBe("Read slowly, aloud");
  });

  it("downloads Excel templates that import exactly like the CSV templates", () => {
    for (const mode of ["calendar", "personal"] as const) {
      const fromXlsx = parsePlanXlsx(planTemplateXlsx(mode), mode);
      const fromCsv = parsePlanCsv(planTemplate(mode), mode);
      expect(fromXlsx.errors).toEqual([]);
      expect(fromXlsx.rows).toEqual(fromCsv.rows);
    }
  });

  it("applies the same rules as CSV: a date typed as text must be YYYY-MM-DD", () => {
    const bytes = workbook(`<row r="1">${str("A1", "date")}${str("B1", "passages")}</row><row r="2">${str("A2", "11/1/2027")}${str("B2", "John 1")}</row>`);
    const r = parsePlanXlsx(bytes, "calendar");
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ row: 2, message: "Write the date as YYYY-MM-DD (for example 2027-01-01), not “11/1/2027”." }]);
  });

  it("reads shared and rich-text strings, saved formula results, and gaps between cells", () => {
    const bytes = workbook(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>` +
        `<row r="7"><c r="A7"><v>4</v></c><c r="C7" t="str"><f>CONCAT("John ","5")</f><v>John 5</v></c></row>` +
        `<row r="8"><c r="A8"><v>5.0000000000000009</v></c><c r="C8" t="s"><v>2</v></c></row>`,
      { shared: `<si><t>day</t></si><si><t>passages</t></si><si><r><t>Psalm </t></r><r><rPr><b/></rPr><t>23</t></r></si>` },
    );
    const r = parsePlanXlsx(bytes, "personal");
    expect(r.errors).toEqual([]);
    expect(summary(r)).toEqual([
      [7, 4, "reading", "John 5"],
      [8, 5, "reading", "Psalm 23"],
    ]);
  });

  it("refuses files that aren't workbooks, XML with DOCTYPE, oversized parts, and too many columns", () => {
    const err = (bytes: Uint8Array) => parsePlanXlsx(bytes, "personal").errors[0]?.message;
    expect(err(strToU8("day,passages\n1,John 1\n"))).toMatch(/isn't an \.xlsx workbook/);
    expect(err(zipSync({ "x.txt": strToU8("hi") }))).toMatch(/has no workbook part/);
    const doctype = zipSync({
      "xl/workbook.xml": strToU8('<!DOCTYPE x [<!ENTITY a "aaaa">]><workbook/>'),
    });
    expect(err(doctype)).toMatch(/XML features that aren't allowed/);
    // 20 MB of zeros compresses to a few KB; the declared size is refused before inflating.
    const bomb = zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(20 * 1024 * 1024) }, { level: 9 });
    expect(bomb.byteLength).toBeLessThan(PLAN_IMPORT_LIMITS.maxBytes);
    expect(err(bomb)).toMatch(/too large once opened/);
    const wide = workbook(`<row r="3">${str("A3", "day")}${str("Q3", "too far")}</row>`);
    expect(parsePlanXlsx(wide, "personal").errors[0]).toEqual({ row: 3, message: "A row has more than 16 columns." });
  });

  it("recognises date formats and converts serials", () => {
    expect(["m/d/yyyy", "d-mmm-yy", "yyyy-mm-dd", "[$-409]mmmm d, yyyy", "dddd"].every(isDateFormat)).toBe(true);
    expect(["0", "0.00", "h:mm", "mm:ss", '"Day "0', "General"].some(isDateFormat)).toBe(false);
    expect(excelSerialToYmd(1)).toBe("1900-01-01");
    expect(excelSerialToYmd(61)).toBe("1900-03-01");
    // Cross-checked with openpyxl's from_excel.
    expect(excelSerialToYmd(46326)).toBe("2026-10-31");
    expect(excelSerialToYmd(46327.75)).toBe("2026-11-01");
    expect(excelSerialToYmd(0, true)).toBeNull();
    expect(excelSerialToYmd(1, true)).toBe("1904-01-02");
  });

  it("uses the date style of the cell, from built-in or custom formats", () => {
    const styles = `<numFmts count="1"><numFmt numFmtId="170" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="170"/></cellXfs>`;
    const rows = readXlsxTable(
      workbook(`<row r="1"><c r="A1" s="1"><v>46326</v></c><c r="B1" s="2"><v>46327</v></c><c r="C1"><v>46329</v></c></row>`, { styles }),
      PLAN_IMPORT_LIMITS,
    );
    expect(rows).toEqual([{ line: 1, cells: ["2026-10-31", "2026-11-01", "46329"] }]);
  });
});
