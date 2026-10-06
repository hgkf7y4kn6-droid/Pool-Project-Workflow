import { describe, expect, it } from "vitest";
import { checkTaskCompletion, checklistProgress } from "../src/checklist";
import { availableChangeOrderTransitions, checkChangeOrderTransition } from "../src/change-orders";
import {
  can,
  changeOrderVisibleToClient,
  projectAccessScope,
  redactChangeOrderForClient,
  redactProjectForClient,
} from "../src/permissions";
import { correctiveTasksFor, deriveInspectionResult } from "../src/inspections";
import { computeCompletionPct, computeScheduleSummary } from "../src/progress";
import { evaluateWeatherRisks } from "../src/weather";
import type { ChangeOrder, Project } from "@pool/types";

describe("task checklist completion", () => {
  const items = [
    { id: "1", label: "Pump installed", required: true, isChecked: true },
    { id: "2", label: "Pressure tested", required: true, isChecked: false },
    { id: "3", label: "Heater installed", required: false, isChecked: false },
  ];

  it("blocks completion while mandatory items are open", () => {
    const r = checkTaskCompletion(items, "field_worker");
    expect(r.allowed).toBe(false);
    expect(r.blockingItems.map((i) => i.id)).toEqual(["2"]);
  });

  it("allows an override only with permission and a reason", () => {
    expect(checkTaskCompletion(items, "field_worker", { override: true, overrideReason: "x" }).reason).toBe(
      "override_not_permitted",
    );
    expect(checkTaskCompletion(items, "field_supervisor", { override: true }).reason).toBe("override_reason_required");
    const ok = checkTaskCompletion(items, "field_supervisor", { override: true, overrideReason: "Tested by sub" });
    expect(ok).toMatchObject({ allowed: true, overridden: true });
  });

  it("requires photos on photo-mandatory items", () => {
    const r = checkTaskCompletion(
      [{ id: "p", label: "Photos captured", required: true, requiresPhoto: true, isChecked: true, photoCount: 0 }],
      "field_worker",
    );
    expect(r.allowed).toBe(false);
    expect(r.missingPhotos).toHaveLength(1);
  });

  it("reports progress", () => {
    expect(checklistProgress(items)).toEqual({ done: 1, total: 3, pct: 33 });
  });
});

describe("change order workflow", () => {
  it("lets a client approve with a signature, but not edit drafts", () => {
    expect(checkChangeOrderTransition("client_review", "approved", "client")).toEqual({
      allowed: true,
      requiresSignature: true,
    });
    expect(checkChangeOrderTransition("draft", "submitted", "client")).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("rejects invalid transitions", () => {
    expect(checkChangeOrderTransition("draft", "approved", "admin")).toEqual({
      allowed: false,
      reason: "invalid_transition",
    });
    expect(checkChangeOrderTransition("completed", "void", "admin").allowed).toBe(false);
  });

  it("lists transitions per role", () => {
    expect(availableChangeOrderTransitions("client_review", "client").sort()).toEqual(["approved", "rejected"]);
    expect(availableChangeOrderTransitions("client_review", "field_worker")).toEqual([]);
  });
});

describe("permissions", () => {
  it("scopes project access by role", () => {
    expect(projectAccessScope("admin")).toBe("organization");
    expect(projectAccessScope("field_worker")).toBe("assigned");
    expect(projectAccessScope("client")).toBe("client");
  });

  it("keeps internal financials away from clients and field workers", () => {
    expect(can("client", "budget:read")).toBe(false);
    expect(can("field_worker", "budget:read")).toBe(false);
    expect(can("subcontractor", "message:read_internal")).toBe(false);
    expect(can("project_manager", "budget:read")).toBe(true);
  });

  it("redacts projects and change orders for clients", () => {
    const project = { id: "p", contractAmountCents: 1000, estimatedCostCents: 700, crewTeamId: "c" } as Project;
    const hidden = redactProjectForClient(project, { clientCanSeeContractAmount: false });
    expect(hidden).not.toHaveProperty("estimatedCostCents");
    expect(hidden).not.toHaveProperty("crewTeamId");
    expect(hidden.contractAmountCents).toBeNull();
    expect(redactProjectForClient(project, { clientCanSeeContractAmount: true }).contractAmountCents).toBe(1000);

    const co = { id: "c", status: "client_review", costCents: 10, priceCents: 20, laborHoursImpact: 4 } as ChangeOrder;
    expect(redactChangeOrderForClient(co)).not.toHaveProperty("costCents");
    expect(changeOrderVisibleToClient({ status: "draft" })).toBe(false);
    expect(changeOrderVisibleToClient({ status: "client_review" })).toBe(true);
  });
});

describe("inspections", () => {
  it("derives the overall result and corrective tasks", () => {
    const items = [
      { key: "a", label: "Rebar spacing", result: "pass" as const },
      { key: "b", label: "Bonding", result: "fail" as const, notes: "Missing lug", correctiveAction: "Add lug" },
    ];
    expect(deriveInspectionResult(items)).toBe("partial");
    expect(deriveInspectionResult([{ result: "fail" }])).toBe("fail");
    expect(deriveInspectionResult([{ result: "pass" }, { result: "na" }])).toBe("pass");
    const tasks = correctiveTasksFor("pre_gunite", items);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Correct: Bonding", priority: "urgent", sourceItemKey: "b" });
    expect(tasks[0]!.description).toContain("Add lug");
  });
});

describe("progress", () => {
  it("weights stages and gives partial credit", () => {
    expect(
      computeCompletionPct([
        { key: "excavation", status: "completed" },
        { key: "plumbing", status: "in_progress", tasks: [{ status: "done" }, { status: "todo" }] },
        { key: "gunite", status: "not_started" },
        { key: "permits", status: "skipped" },
      ]),
    ).toBe(Math.round(((8 + 3.5) / 25) * 100));
  });

  it("summarizes schedule variance", () => {
    expect(
      computeScheduleSummary({
        plannedStartDate: "2026-09-01",
        plannedCompletionDate: "2026-11-01",
        projectedCompletionDate: "2026-11-08",
        actualCompletionDate: null,
        today: "2026-10-06",
      }),
    ).toMatchObject({ scheduleVarianceDays: 7, daysRemaining: 33, status: "behind" });
  });
});

describe("weather risks", () => {
  it("warns about rain on weather-sensitive work and ignores other days", () => {
    const warnings = evaluateWeatherRisks(
      [{ id: "t", title: "Excavation", stageKey: "excavation", plannedStartDate: "2026-10-07", plannedEndDate: "2026-10-08" }],
      [
        { date: "2026-10-06", tempMinC: 15, tempMaxC: 25, precipitationProbabilityPct: 90, precipitationMm: 20, windSpeedMaxKph: 10, weatherCode: 63, summary: "" },
        { date: "2026-10-07", tempMinC: 15, tempMaxC: 25, precipitationProbabilityPct: 85, precipitationMm: 18, windSpeedMaxKph: 10, weatherCode: 63, summary: "" },
        { date: "2026-10-08", tempMinC: 15, tempMaxC: 25, precipitationProbabilityPct: 10, precipitationMm: 0, windSpeedMaxKph: 10, weatherCode: 1, summary: "" },
      ],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ taskId: "t", date: "2026-10-07", severity: "warning" });
    expect(warnings[0]!.message).toMatch(/^Heavy rain expected on 2026-10-07\. Excavation may require rescheduling/);
  });
});

import { planStages } from "../src/plan";
import { DEFAULT_STAGE_TEMPLATES } from "../src/stages";

describe("planStages", () => {
  it("chains the default lifecycle back to back on working days", () => {
    const { stages, completionDate } = planStages(
      DEFAULT_STAGE_TEMPLATES.map((t, i) => ({ ...t, sortOrder: i })),
      "2026-10-05",
    );
    expect(stages).toHaveLength(17);
    expect(stages[0]).toMatchObject({ key: "contract", plannedStartDate: "2026-10-05", durationDays: 0 });
    // Design (10 days) starts the same day as the zero-length contract milestone.
    expect(stages[1]).toMatchObject({ key: "design", plannedStartDate: "2026-10-05", plannedEndDate: "2026-10-16" });
    expect(stages[2]).toMatchObject({ key: "permits", plannedStartDate: "2026-10-19" });
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i]!.plannedStartDate >= stages[i - 1]!.plannedEndDate).toBe(true);
    }
    expect(completionDate).toBe(stages.at(-1)!.plannedEndDate);
  });
});
