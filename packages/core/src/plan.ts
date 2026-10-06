import type { ChecklistTemplateItem } from "@pool/types";
import { WorkCalendar } from "./calendar";
import { computeSchedule } from "./schedule";

export interface PlanStageTemplate {
  key: string;
  name: string;
  sortOrder: number;
  defaultDurationDays: number;
  isMilestone: boolean;
  weatherSensitive: boolean;
  checklist: ChecklistTemplateItem[];
}

export interface PlannedStage extends PlanStageTemplate {
  durationDays: number;
  plannedStartDate: string;
  plannedEndDate: string;
}

/**
 * Lay out a project's stages back-to-back (finish-to-start) from a start
 * date using the organization's stage templates. Milestones take zero days.
 * The API turns each stage into a stage record plus a stage task carrying the
 * template checklist, chained with FS dependencies, so the scheduling engine
 * can re-plan everything when something slips.
 */
export function planStages(
  templates: PlanStageTemplate[],
  startDate: string,
  calendar: WorkCalendar = new WorkCalendar(),
): { stages: PlannedStage[]; completionDate: string } {
  const ordered = [...templates].sort((a, b) => a.sortOrder - b.sortOrder);
  const items = ordered.map((t) => ({
    id: t.key,
    durationDays: t.isMilestone ? 0 : Math.max(1, t.defaultDurationDays),
  }));
  const deps = ordered.slice(1).map((t, i) => ({
    predecessorId: ordered[i]!.key,
    successorId: t.key,
    type: "FS" as const,
  }));
  const schedule = computeSchedule(items, deps, { projectStart: startDate, calendar });
  const stages = ordered.map((t, i) => {
    const s = schedule.items.get(t.key)!;
    return {
      ...t,
      durationDays: items[i]!.durationDays,
      plannedStartDate: s.startDate,
      plannedEndDate: s.finishDate,
    };
  });
  return { stages, completionDate: schedule.projectFinish };
}
