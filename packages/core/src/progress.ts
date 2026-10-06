import type { StageStatus, TaskStatus } from "@pool/types";
import { diffCalendarDays } from "./calendar";
import { stageWeight } from "./stages";

export interface StageProgressInput {
  key: string;
  status: StageStatus;
  /** Tasks attached to the stage, used for partial credit of in-progress stages. */
  tasks?: { status: TaskStatus }[];
}

/**
 * Weighted completion percentage across stages. Completed and skipped stages
 * count fully; an in-progress stage earns credit proportional to its finished
 * tasks (or half credit if it has no tasks).
 */
export function computeCompletionPct(stages: StageProgressInput[]): number {
  let total = 0;
  let earned = 0;
  for (const stage of stages) {
    const weight = stageWeight(stage.key);
    if (stage.status === "skipped") continue;
    total += weight;
    if (stage.status === "completed") earned += weight;
    else if (stage.status === "in_progress") {
      const tasks = (stage.tasks ?? []).filter((t) => t.status !== "cancelled");
      const fraction = tasks.length ? tasks.filter((t) => t.status === "done").length / tasks.length : 0.5;
      earned += weight * Math.min(fraction, 0.95);
    }
  }
  return total === 0 ? 0 : Math.round((earned / total) * 100);
}

export interface ScheduleSummaryInput {
  plannedStartDate: string | null;
  plannedCompletionDate: string | null;
  projectedCompletionDate: string | null;
  actualCompletionDate: string | null;
  today: string;
}

export interface ScheduleSummary {
  plannedStartDate: string | null;
  plannedCompletionDate: string | null;
  projectedCompletionDate: string | null;
  /** Calendar days until projected (or planned) completion; negative when past. */
  daysRemaining: number | null;
  /** Calendar days projected completion is behind (+) or ahead (−) of plan. */
  scheduleVarianceDays: number | null;
  status: "on_track" | "at_risk" | "behind" | "complete" | "unscheduled";
}

export function computeScheduleSummary(input: ScheduleSummaryInput): ScheduleSummary {
  const projected = input.projectedCompletionDate ?? input.plannedCompletionDate;
  const variance =
    input.plannedCompletionDate && projected ? diffCalendarDays(input.plannedCompletionDate, projected) : null;
  const daysRemaining = projected ? diffCalendarDays(input.today, projected) : null;
  let status: ScheduleSummary["status"];
  if (input.actualCompletionDate) status = "complete";
  else if (!projected) status = "unscheduled";
  else if ((variance ?? 0) > 3 || (daysRemaining !== null && daysRemaining < 0)) status = "behind";
  else if ((variance ?? 0) > 0) status = "at_risk";
  else status = "on_track";
  return {
    plannedStartDate: input.plannedStartDate,
    plannedCompletionDate: input.plannedCompletionDate,
    projectedCompletionDate: projected,
    daysRemaining: input.actualCompletionDate ? 0 : daysRemaining,
    scheduleVarianceDays: variance,
    status,
  };
}
