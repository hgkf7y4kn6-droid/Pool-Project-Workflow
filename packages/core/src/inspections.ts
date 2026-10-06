import type { InspectionItemResult, InspectionResult, TaskPriority } from "@pool/types";

/** Overall result from item results: any fail → fail; all pass/na → pass. */
export function deriveInspectionResult(items: Pick<InspectionItemResult, "result">[]): InspectionResult {
  if (items.length === 0) return "pending";
  if (items.some((i) => i.result === "fail")) return items.some((i) => i.result === "pass") ? "partial" : "fail";
  if (items.some((i) => i.result === "pending")) return "pending";
  return "pass";
}

export interface CorrectiveTaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  durationDays: number;
  sourceItemKey: string;
}

/** Build corrective-action tasks for every failed inspection item. */
export function correctiveTasksFor(
  inspectionType: string,
  items: InspectionItemResult[],
): CorrectiveTaskDraft[] {
  return items
    .filter((i) => i.result === "fail")
    .map((i) => ({
      title: `Correct: ${i.label}`,
      description: [
        `Failed during ${inspectionType.replace(/_/g, " ")} inspection.`,
        i.notes ? `Inspector notes: ${i.notes}` : null,
        i.correctiveAction ? `Required action: ${i.correctiveAction}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      priority: "urgent" as const,
      durationDays: 1,
      sourceItemKey: i.key,
    }));
}
