import { describe, expect, it } from "vitest";
import { formatCents, parseDollarsToCents } from "./money";

describe("money", () => {
  it("parses dollar input into integer cents", () => {
    expect(parseDollarsToCents("25")).toBe(2500);
    expect(parseDollarsToCents("25.5")).toBe(2550);
    expect(parseDollarsToCents("$1,000.05")).toBe(100005);
    expect(parseDollarsToCents(" 0.99 ")).toBe(99);
  });

  it("rejects anything that isn't a plain positive amount", () => {
    for (const bad of ["", "0", "0.00", "-5", "1.234", "abc", "1e3", "12,34", "10000000", "Infinity", "1..2"]) {
      expect(parseDollarsToCents(bad)).toBeNull();
    }
  });

  it("formats cents without floating point errors", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-500)).toBe("−$5.00");
  });
});
