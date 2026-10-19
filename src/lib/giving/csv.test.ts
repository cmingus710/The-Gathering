import { describe, expect, it } from "vitest";
import { centsToDecimal, csvCell, toCsv } from "./csv";

describe("CSV export", () => {
  it("neutralises spreadsheet formulas", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      const cell = csvCell(evil);
      expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell("Plain name")).toBe("Plain name");
  });

  it("quotes commas, quotes, and newlines", () => {
    expect(csvCell('Smith, "Jo"')).toBe('"Smith, ""Jo"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("writes numbers and decimals exactly", () => {
    expect(centsToDecimal(1250)).toBe("12.50");
    expect(centsToDecimal(-5)).toBe("-0.05");
    expect(centsToDecimal(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });
});
