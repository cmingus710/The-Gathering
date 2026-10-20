import { strToU8, unzipSync, zipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { CsvError, type CsvLimits, type CsvRow } from "./csv";

/**
 * Reads the first worksheet of an Excel workbook (.xlsx: Excel, Numbers, or
 * Google Sheets "Download as .xlsx") into the same rows the CSV parser
 * produces, so reading plan imports validate both the same way.
 *
 * - Cells are read as values, never evaluated: a formula contributes the
 *   result Excel saved with it, and nothing in the file is run.
 * - A cell formatted as a date becomes YYYY-MM-DD from the stored date
 *   serial (1900 or 1904 system), so dates typed as 11/1/2027 or 1-Nov-27
 *   can't be misread as day/month. Other numbers keep their plain value.
 * - Safety: the zip's declared sizes are checked before anything is
 *   inflated, only the parts needed are read, and XML with DOCTYPE or entity
 *   declarations is refused. Row, column, and cell limits match the CSV's.
 * - Line numbers are the sheet's own row numbers, so problems point at the
 *   row the person sees in Excel. Blank rows are skipped.
 */
const MAX_UNZIPPED = 16 * 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  isArray: (name) => ["row", "c", "si", "r", "sheet", "Relationship", "xf", "numFmt"].includes(name),
});

type Node = Record<string, unknown>;

function parseXml(bytes: Uint8Array | undefined, what: string): Node {
  if (!bytes) throw new CsvError(`This workbook has no ${what}. Save it again from Excel as .xlsx.`);
  const xml = new TextDecoder("utf-8").decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new CsvError("This workbook uses XML features that aren't allowed. Save it again from Excel as .xlsx.");
  return parser.parse(xml) as Node;
}

/** Text of a <t> node: a plain string, or { "#text": … } when it has attributes. */
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "#text" in node) return String((node as Node)["#text"]);
  return "";
}

/** Shared string: <t> or rich-text runs <r><t>. */
function sharedString(si: Node): string {
  if ("t" in si) return text(si.t);
  return ((si.r as Node[] | undefined) ?? []).map((r) => text(r.t)).join("");
}

/** Built-in number formats that display a date (ECMA-376 §18.8.30, incl. CJK locales). */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);

/** A custom format shows a date when, outside quotes and brackets, it has d or y (or m without h/s). */
export function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "").toLowerCase();
  return /[dy]/.test(bare) || (/m/.test(bare) && !/[hs]/.test(bare));
}

/** Excel date serial → YYYY-MM-DD (time of day ignored). */
export function excelSerialToYmd(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  // 1900 system: day 1 is 1900-01-01, and Excel counts a February 29, 1900
  // that never existed, so from day 61 on the epoch is 1899-12-30.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/** Column letters of a cell reference ("BC12" → 54, zero-based). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolve(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const p of target.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

export function readXlsxTable(bytes: Uint8Array, limits: CsvLimits): CsvRow[] {
  if (bytes.byteLength > limits.maxBytes) throw new CsvError(`The file is larger than ${Math.round(limits.maxBytes / 1024 / 1024) || 1} MB.`);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new CsvError("This isn't an .xlsx workbook. In Excel choose File → Save As → Excel Workbook (.xlsx), or upload a .csv.");
  }
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        const wanted = f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml" || f.name === "xl/styles.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(f.name);
        if (!wanted) return false;
        total += f.originalSize;
        if (f.originalSize > MAX_UNZIPPED || total > MAX_UNZIPPED) throw new CsvError("The workbook is too large once opened. Keep only the plan's sheet, or upload a .csv.");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof CsvError) throw e;
    throw new CsvError("This workbook couldn't be opened. Save it again from Excel as .xlsx, or upload a .csv.");
  }

  // The first sheet in the workbook's own order.
  const workbook = parseXml(files["xl/workbook.xml"], "workbook part");
  const wb = workbook.workbook as Node | undefined;
  const firstSheet = ((wb?.sheets as Node | undefined)?.sheet as Node[] | undefined)?.[0];
  const relId = firstSheet?.["@_r:id"] as string | undefined;
  const rels = (parseXml(files["xl/_rels/workbook.xml.rels"], "sheet list").Relationships as Node | undefined)?.Relationship as Node[] | undefined;
  const target = rels?.find((r) => r["@_Id"] === relId)?.["@_Target"] as string | undefined;
  const sheetPath = target ? resolve("xl/workbook.xml", target) : "xl/worksheets/sheet1.xml";
  const date1904 = ["1", "true"].includes(String((wb?.workbookPr as Node | undefined)?.["@_date1904"] ?? ""));

  const shared = files["xl/sharedStrings.xml"] ? (((parseXml(files["xl/sharedStrings.xml"], "text list").sst as Node | undefined)?.si as Node[] | undefined) ?? []).map(sharedString) : [];

  // Which cell styles display a date.
  const dateStyles = new Set<number>();
  if (files["xl/styles.xml"]) {
    const ss = parseXml(files["xl/styles.xml"], "styles").styleSheet as Node | undefined;
    const custom = new Map<number, string>((((ss?.numFmts as Node | undefined)?.numFmt as Node[] | undefined) ?? []).map((f) => [Number(f["@_numFmtId"]), String(f["@_formatCode"] ?? "")]));
    (((ss?.cellXfs as Node | undefined)?.xf as Node[] | undefined) ?? []).forEach((xf, i) => {
      const id = Number(xf["@_numFmtId"] ?? 0);
      if (DATE_FORMAT_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) dateStyles.add(i);
    });
  }

  const sheet = parseXml(files[sheetPath], "worksheet").worksheet as Node | undefined;
  const xmlRows = ((sheet?.sheetData as Node | undefined)?.row as Node[] | undefined) ?? [];
  const rows: CsvRow[] = [];
  let previous = 0;
  for (const row of xmlRows) {
    const line = Number(row["@_r"]) || previous + 1;
    previous = line;
    const cells: string[] = [];
    let next = 0;
    for (const c of (row.c as Node[] | undefined) ?? []) {
      const col = c["@_r"] ? columnIndex(String(c["@_r"])) : next;
      next = col + 1;
      if (col >= limits.maxColumns) {
        if (cellValue(c, shared, dateStyles, date1904) !== "") throw new CsvError(`A row has more than ${limits.maxColumns} columns.`, line);
        continue;
      }
      const value = cellValue(c, shared, dateStyles, date1904);
      if (value.length > limits.maxCellChars) throw new CsvError(`A value is longer than ${limits.maxCellChars} characters.`, line);
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    if (cells.every((v) => v.trim() === "")) continue;
    rows.push({ line, cells });
    if (rows.length > limits.maxRows) throw new CsvError(`The sheet has more than ${limits.maxRows} rows.`, line);
  }
  return rows;
}

function cellValue(c: Node, shared: string[], dateStyles: Set<number>, date1904: boolean): string {
  const type = String(c["@_t"] ?? "n");
  const raw = text(c.v);
  switch (type) {
    case "s":
      return shared[Number(raw)] ?? "";
    case "inlineStr":
      return sharedString((c.is as Node | undefined) ?? {});
    case "str":
    case "e":
      return raw;
    case "b":
      return raw === "1" ? "TRUE" : "FALSE";
    case "d":
      return raw.slice(0, 10);
    default: {
      if (raw === "") return "";
      if (dateStyles.has(Number(c["@_s"] ?? 0))) return excelSerialToYmd(Number(raw), date1904) ?? raw;
      // Whole numbers as typed (Excel stores 3 as "3", sometimes "3.0000000000000004").
      const n = Number(raw);
      return Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : raw;
    }
  }
}

// ---------------------------------------------------------------------------
// Writing: a minimal one-sheet workbook for templates.
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columnName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Days from the 1900 epoch for a YYYY-MM-DD (the inverse of excelSerialToYmd for modern dates). */
function ymdToSerial(ymd: string): number {
  return Math.round((Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/**
 * A workbook with one sheet: a bold header row and text cells, except
 * `dateColumn` (real dates shown as yyyy-mm-dd) and `numberColumn` (numbers).
 */
export function writeXlsx(sheetName: string, header: string[], rows: string[][], opts: { dateColumn?: number; numberColumn?: number; widths?: number[] } = {}): Uint8Array {
  const cell = (v: string, r: number, c: number, head: boolean) => {
    const ref = `${columnName(c)}${r}`;
    if (head) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    if (v === "") return "";
    if (c === opts.dateColumn && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="2"><v>${ymdToSerial(v)}</v></c>`;
    if (c === opts.numberColumn && /^\d+$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const sheetRows = [header, ...rows].map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i + 1, c, i === 0)).join("")}</row>`).join("");
  const cols = opts.widths ? `<cols>${opts.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns} xmlns:r="${rel}"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}>${cols}<sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}
