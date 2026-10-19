import { describe, expect, it } from "vitest";
import { manualInput } from "./manual";

const base = {
  formToken: "3f1c2a8e-5b7d-4c9e-8f10-2a3b4c5d6e7f",
  receivedOn: "2026-10-19",
  amount: "40.00",
  fundId: "6adeba86-8a26-4b1e-8732-6ed0ad6f6135",
  method: "check",
};

describe("manual gift form", () => {
  it("accepts a linked member, where the donor name box isn't shown", () => {
    const r = manualInput.safeParse({ ...base, donorProfileId: "08f96c6c-6966-4f0e-b676-052abb3ca22d", checkReference: "1001", note: "" });
    expect(r.success).toBe(true);
    expect(r.data?.donorName).toBe("");
    expect(r.data?.donorProfileId).toBe("08f96c6c-6966-4f0e-b676-052abb3ca22d");
  });

  it("accepts an unidentified donor with nothing optional filled in", () => {
    const r = manualInput.safeParse({ ...base, donorProfileId: "", donorName: "" });
    expect(r.success).toBe(true);
    expect(r.data?.donorProfileId).toBeNull();
  });

  it("still rejects a missing fund or bad date", () => {
    expect(manualInput.safeParse({ ...base, fundId: "" }).success).toBe(false);
    expect(manualInput.safeParse({ ...base, receivedOn: "10/19/2026" }).success).toBe(false);
  });
});
