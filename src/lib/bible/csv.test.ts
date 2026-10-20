import { describe, expect, it } from "vitest";
import { CsvError, headerKey, parseCsv } from "./csv";

const L = { maxBytes: 10_000, maxRows: 10, maxCellChars: 100, maxColumns: 6 };

describe("parseCsv", () => {
  it("reads quoted cells with commas, quotes, and line breaks, CRLF, and a BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"line 1\nline 2",z\n', L);
    expect(rows).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["x, y", 'say "hi"'] },
      { line: 3, cells: ["line 1\nline 2", "z"] },
    ]);
  });

  it("skips blank lines and keeps line numbers", () => {
    expect(parseCsv("a\n\nb\n", L)).toEqual([{ line: 1, cells: ["a"] }, { line: 3, cells: ["b"] }]);
  });

  it("supports tab-separated files", () => {
    expect(parseCsv("a\tb,c\n", { ...L, delimiter: "\t" })).toEqual([{ line: 1, cells: ["a", "b,c"] }]);
  });

  it("treats formula-like text as text", () => {
    expect(parseCsv("=HYPERLINK(1),@x\n", L)[0].cells).toEqual(["=HYPERLINK(1)", "@x"]);
  });

  it("refuses malformed quoting and enforces limits early", () => {
    expect(() => parseCsv('a"b\n', L)).toThrow(CsvError);
    expect(() => parseCsv('"open\n', L)).toThrow(/isn't closed/);
    expect(() => parseCsv('"a"b\n', L)).toThrow(/follows a closing quote/);
    expect(() => parseCsv("x".repeat(10_001), L)).toThrow(/larger than/);
    expect(() => parseCsv(Array(12).fill("a").join("\n"), L)).toThrow(/more than 10 rows/);
    expect(() => parseCsv("a,b,c,d,e,f,g\n", L)).toThrow(/more than 6 columns/);
    expect(() => parseCsv(`${"y".repeat(101)}\n`, L)).toThrow(/longer than 100/);
    expect(() => parseCsv("a\u0000b", L)).toThrow(/text file/);
  });

  it("normalizes header names", () => {
    expect(headerKey(" Day Number ")).toBe("day_number");
    expect(headerKey("Passages")).toBe("passages");
  });
});
