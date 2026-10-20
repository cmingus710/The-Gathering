/**
 * A small, strict RFC 4180 parser for uploaded files (reading plan imports
 * and structured scripture). Handles quoted fields with commas, quotes, and
 * line breaks, CRLF or LF line ends, and a UTF-8 byte-order mark. Limits are
 * enforced while reading, so an oversized or malformed file stops early
 * instead of being parsed in full. Nothing is evaluated: every cell is text.
 */
export type CsvRow = { line: number; cells: string[] };

export type CsvLimits = { maxBytes: number; maxRows: number; maxCellChars: number; maxColumns: number; delimiter?: "," | "\t" };

export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number | null = null,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

export function parseCsv(input: string, limits: CsvLimits): CsvRow[] {
  if (Buffer.byteLength(input, "utf8") > limits.maxBytes) {
    throw new CsvError(`The file is larger than ${Math.round(limits.maxBytes / 1024 / 1024) || 1} MB.`);
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.includes("\u0000")) throw new CsvError("This doesn't look like a text file.");
  const d = limits.delimiter ?? ",";
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let afterQuote = false;
  const pushCell = () => {
    if (cell.length > limits.maxCellChars) throw new CsvError(`A value is longer than ${limits.maxCellChars} characters.`, rowLine);
    cells.push(cell);
    if (cells.length > limits.maxColumns) throw new CsvError(`A row has more than ${limits.maxColumns} columns.`, rowLine);
    cell = "";
    afterQuote = false;
  };
  const pushRow = () => {
    pushCell();
    // Skip completely blank lines.
    if (!(cells.length === 1 && cells[0] === "")) {
      rows.push({ line: rowLine, cells });
      if (rows.length > limits.maxRows) throw new CsvError(`The file has more than ${limits.maxRows} rows.`, rowLine);
    }
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell !== "" || afterQuote) throw new CsvError("A quote appears in the middle of a value. Put the whole value in quotes.", line);
      quoted = true;
    } else if (ch === d) {
      pushCell();
    } else if (ch === "\r" && text[i + 1] === "\n") {
      // CRLF: handled at the \n.
    } else if (ch === "\n" || ch === "\r") {
      pushRow();
      line++;
      rowLine = line;
    } else {
      if (afterQuote) throw new CsvError("Text follows a closing quote. Put the whole value in quotes.", line);
      cell += ch;
    }
  }
  if (quoted) throw new CsvError("A quoted value isn't closed.", rowLine);
  if (cell !== "" || cells.length || afterQuote) pushRow();
  return rows;
}

/** Header names normalized for matching ("Day Number" → "day_number"). */
export function headerKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
