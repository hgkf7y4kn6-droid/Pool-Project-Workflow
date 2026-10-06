import { describe, expect, it } from "vitest";
import { WorkCalendar } from "../src/calendar";
import {
  ScheduleCycleError,
  analyzeScheduleChange,
  computeSchedule,
  findDependencyViolations,
  findResourceConflicts,
  topologicalOrder,
  wouldCreateCycle,
  type ScheduleDependency,
  type ScheduleItem,
} from "../src/schedule";

const projectStart = "2026-10-05"; // Monday

const items: ScheduleItem[] = [
  { id: "exc", title: "Excavation", durationDays: 3, plannedStartDate: "2026-10-05" },
  { id: "plb", title: "Plumbing", durationDays: 2, plannedStartDate: "2026-10-08" },
  { id: "stl", title: "Steel", durationDays: 2, plannedStartDate: "2026-10-12" },
  { id: "ins", title: "Inspection", durationDays: 0, plannedStartDate: "2026-10-14" },
  { id: "gun", title: "Gunite", durationDays: 1, plannedStartDate: "2026-10-14" },
  { id: "ele", title: "Electrical", durationDays: 1, plannedStartDate: "2026-10-09" },
];

const deps: ScheduleDependency[] = [
  { predecessorId: "exc", successorId: "plb", type: "FS" },
  { predecessorId: "plb", successorId: "stl", type: "FS" },
  { predecessorId: "stl", successorId: "ins", type: "FS" },
  { predecessorId: "ins", successorId: "gun", type: "FS" },
  { predecessorId: "plb", successorId: "ele", type: "SS", lagDays: 1 },
];

describe("computeSchedule", () => {
  it("computes a finish-to-start chain over weekends", () => {
    const r = computeSchedule(items, deps, { projectStart });
    expect(r.items.get("exc")).toMatchObject({ startDate: "2026-10-05", finishDate: "2026-10-07" });
    expect(r.items.get("plb")).toMatchObject({ startDate: "2026-10-08", finishDate: "2026-10-09" });
    expect(r.items.get("stl")).toMatchObject({ startDate: "2026-10-12", finishDate: "2026-10-13" });
    expect(r.items.get("ins")).toMatchObject({ startDate: "2026-10-14", finishDate: "2026-10-14" });
    expect(r.items.get("gun")).toMatchObject({ startDate: "2026-10-14", finishDate: "2026-10-14" });
    expect(r.projectFinish).toBe("2026-10-14");
  });

  it("identifies the critical path and float", () => {
    const r = computeSchedule(items, deps, { projectStart });
    expect(r.criticalPath).toEqual(["exc", "plb", "stl", "ins", "gun"]);
    expect(r.items.get("ele")!.critical).toBe(false);
    expect(r.items.get("ele")!.totalFloat).toBe(3);
  });

  it("supports start-to-start lag and finish-to-finish", () => {
    const r = computeSchedule(
      [
        { id: "a", durationDays: 3 },
        { id: "b", durationDays: 1 },
        { id: "c", durationDays: 2 },
      ],
      [
        { predecessorId: "a", successorId: "b", type: "FF" },
        { predecessorId: "a", successorId: "c", type: "SS", lagDays: 2 },
      ],
      { projectStart },
    );
    expect(r.items.get("b")).toMatchObject({ startDate: "2026-10-07", finishDate: "2026-10-07" });
    expect(r.items.get("c")).toMatchObject({ startDate: "2026-10-07", finishDate: "2026-10-08" });
  });

  it("respects holidays", () => {
    const calendar = new WorkCalendar({ holidays: ["2026-10-12"] });
    const r = computeSchedule(items, deps, { projectStart, calendar });
    expect(r.items.get("stl")).toMatchObject({ startDate: "2026-10-13", finishDate: "2026-10-14" });
  });

  it("anchors started and finished work to actual dates", () => {
    const actual = items.map((i) =>
      i.id === "exc" ? { ...i, actualStartDate: "2026-10-05", actualEndDate: "2026-10-08", status: "done" as const } : i,
    );
    const r = computeSchedule(actual, deps, { projectStart });
    expect(r.items.get("exc")!.fixed).toBe(true);
    expect(r.items.get("plb")!.startDate).toBe("2026-10-09");
    expect(r.projectFinish).toBe("2026-10-15");
  });

  it("ignores cancelled tasks", () => {
    const r = computeSchedule(
      items.map((i) => (i.id === "ele" ? { ...i, status: "cancelled" as const } : i)),
      deps,
      { projectStart },
    );
    expect(r.items.has("ele")).toBe(false);
  });

  it("detects dependency cycles", () => {
    expect(() =>
      topologicalOrder(
        ["a", "b", "c"],
        [
          { predecessorId: "a", successorId: "b", type: "FS" },
          { predecessorId: "b", successorId: "c", type: "FS" },
          { predecessorId: "c", successorId: "a", type: "FS" },
        ],
      ),
    ).toThrow(ScheduleCycleError);
    expect(wouldCreateCycle(deps, { predecessorId: "gun", successorId: "exc" })).toBe(true);
    expect(wouldCreateCycle(deps, { predecessorId: "exc", successorId: "gun" })).toBe(false);
    expect(wouldCreateCycle(deps, { predecessorId: "exc", successorId: "exc" })).toBe(true);
  });
});

describe("analyzeScheduleChange", () => {
  it("propagates an upstream delay to every downstream task", () => {
    const impact = analyzeScheduleChange(items, deps, { taskId: "exc", delayDays: 2 }, { projectStart });
    expect(impact.completionSlipDays).toBe(2);
    expect(impact.proposedFinish).toBe("2026-10-16");
    const byId = Object.fromEntries(impact.impacted.map((i) => [i.id, i]));
    expect(Object.keys(byId).sort()).toEqual(["ele", "exc", "gun", "ins", "plb", "stl"]);
    expect(byId.plb).toMatchObject({ proposedStart: "2026-10-12", shiftDays: 2 });
    expect(byId.gun).toMatchObject({ previousStart: "2026-10-14", proposedStart: "2026-10-16" });
  });

  it("absorbs delays within float without moving the completion date", () => {
    const impact = analyzeScheduleChange(items, deps, { taskId: "ele", delayDays: 2 }, { projectStart });
    expect(impact.completionSlipDays).toBe(0);
    expect(impact.impacted.map((i) => i.id)).toEqual(["ele"]);
  });

  it("never pulls downstream work earlier automatically", () => {
    const impact = analyzeScheduleChange(items, deps, { taskId: "exc", delayDays: -1 }, { projectStart });
    expect(impact.impacted.map((i) => i.id)).toEqual(["exc"]);
    expect(impact.completionSlipDays).toBe(0);
  });
});

describe("validation helpers", () => {
  it("finds planned dates that violate dependencies", () => {
    const broken = items.map((i) => (i.id === "stl" ? { ...i, plannedStartDate: "2026-10-09" } : i));
    expect(findDependencyViolations(broken, deps)).toEqual([
      { predecessorId: "plb", successorId: "stl", type: "FS", requiredShiftDays: 1 },
    ]);
  });

  it("finds crews double-booked on the same day", () => {
    const conflicts = findResourceConflicts([
      { id: "a", durationDays: 2, plannedStartDate: "2026-10-05", resources: ["crew-1"] },
      { id: "b", durationDays: 1, plannedStartDate: "2026-10-06", resources: ["crew-1"] },
      { id: "c", durationDays: 1, plannedStartDate: "2026-10-06", resources: ["crew-2"] },
    ]);
    expect(conflicts).toEqual([{ resource: "crew-1", date: "2026-10-06", taskIds: ["a", "b"] }]);
  });
});
