import { describe, expect, it } from "vitest";
import { assignmentTiming, choosePlan, currentAssignment, groupPlans, nextAssignment, planCompletion, type PlanAssignment } from "./reading-plan";

const a = (id: string, starts_on: string, ends_on: string | null, extra: Partial<PlanAssignment> = {}) =>
  ({ id, starts_on, ends_on, group_id: null, group_name: null, completed: false, ...extra }) as PlanAssignment;

describe("church reading plan schedule", () => {
  const w1 = a("w1", "2026-10-01", "2026-10-07");
  const w2 = a("w2", "2026-10-08", "2026-10-14", { completed: true });
  const w3 = a("w3", "2026-10-15", "2026-10-21");

  it("finds the current assignment by date, inclusive of both ends", () => {
    expect(currentAssignment([w1, w2, w3], "2026-10-08")?.id).toBe("w2");
    expect(currentAssignment([w1, w2, w3], "2026-10-14")?.id).toBe("w2");
    expect(currentAssignment([w1, w2, w3], "2026-09-30")).toBeNull();
    expect(currentAssignment([w1, w2, w3], "2026-10-22")).toBeNull();
  });

  it("prefers the latest start when assignments overlap, regardless of list order", () => {
    const open = a("open", "2026-09-01", null);
    expect(currentAssignment([w2, open], "2026-10-10")?.id).toBe("w2");
    expect(currentAssignment([open, w2], "2026-10-10")?.id).toBe("w2");
    expect(currentAssignment([open], "2026-12-25")?.id).toBe("open");
  });

  it("finds the next assignment when none is current", () => {
    expect(nextAssignment([w3, w2, w1], "2026-09-01")?.id).toBe("w1");
    expect(nextAssignment([w1, w2, w3], "2026-10-21")).toBeNull();
  });

  it("labels timing relative to the current assignment", () => {
    expect(assignmentTiming(w2, "2026-10-10", "w2")).toBe("now");
    expect(assignmentTiming(w1, "2026-10-10", "w2")).toBe("past");
    expect(assignmentTiming(w3, "2026-10-10", "w2")).toBe("upcoming");
  });

  it("counts completions per plan and computes a percentage only from known totals", () => {
    expect(planCompletion({ assignments: [w1, w2, w3] })).toEqual({ done: 1, total: 3, percent: 33 });
    expect(planCompletion({ assignments: [] })).toEqual({ done: 0, total: 0, percent: null });
  });

  it("groups assignments into church-wide and group plans by audience, not title", () => {
    const g1 = a("g1", "2026-10-01", null, { group_id: "grp-b", group_name: "Women's Study" });
    const g2 = a("g2", "2026-10-01", null, { group_id: "grp-a", group_name: "Men's Group" });
    const same = a("w1-copy", "2026-10-01", "2026-10-07", { title: "Week 1", group_id: "grp-a", group_name: "Men's Group" });
    const plans = groupPlans([w1, g1, g2, same, w2]);
    expect(plans.map((p) => p.key)).toEqual(["church", "grp-a", "grp-b"]);
    expect(plans[0].label).toBe("Church-wide");
    expect(plans[0].assignments.map((x) => x.id)).toEqual(["w1", "w2"]);
    expect(plans[1].assignments.map((x) => x.id)).toEqual(["g2", "w1-copy"]);
  });

  it("chooses the requested plan, then the selected assignment's plan, then church-wide", () => {
    const g = a("g", "2026-10-01", null, { group_id: "grp", group_name: "Group" });
    const plans = groupPlans([w1, g]);
    expect(choosePlan(plans, "grp", null)?.key).toBe("grp");
    expect(choosePlan(plans, "nope", "g")?.key).toBe("grp");
    expect(choosePlan(plans, null, null)?.key).toBe("church");
    expect(choosePlan(groupPlans([g]), null, null)?.key).toBe("grp");
    expect(choosePlan([], null, null)).toBeNull();
  });
});
