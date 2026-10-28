import type { Evidence } from "@pool/types";
import { diffCalendarDays, WorkCalendar } from "../calendar";
import { computeSchedule, ScheduleCycleError } from "../schedule";
import type { IntelligenceSnapshot } from "./snapshot";

type Task = IntelligenceSnapshot["tasks"][number];
type Stage = IntelligenceSnapshot["stages"][number];
type Inspection = IntelligenceSnapshot["inspections"][number];

export const isOpenTask = (t: Pick<Task, "status">) => t.status !== "done" && t.status !== "cancelled";
export const isOpenStage = (s: Pick<Stage, "status">) => s.status !== "completed" && s.status !== "skipped";

/** Planned finish of a task: its planned end, else its due date. */
export const taskFinish = (t: Task) => t.plannedEndDate ?? t.dueDate;

/** Indexes and derived facts shared by readiness and rules (computed once per evaluation). */
export class AnalysisContext {
  readonly stages: Stage[];
  readonly stageById: Map<string, Stage>;
  readonly stageByKey: Map<string, Stage>;
  readonly taskById: Map<string, Task>;
  readonly tasksByStage = new Map<string, Task[]>();
  readonly predecessors = new Map<string, IntelligenceSnapshot["dependencies"]>();
  readonly successors = new Map<string, IntelligenceSnapshot["dependencies"]>();
  /** Task ids on the critical path; null when it couldn't be computed (e.g. a dependency cycle). */
  readonly criticalTaskIds: Set<string> | null;
  readonly scheduleNote: string | null;

  constructor(readonly snap: IntelligenceSnapshot) {
    this.stages = [...snap.stages].sort((a, b) => a.sortOrder - b.sortOrder);
    this.stageById = new Map(this.stages.map((s) => [s.id, s]));
    this.stageByKey = new Map(this.stages.map((s) => [s.key, s]));
    this.taskById = new Map(snap.tasks.map((t) => [t.id, t]));
    for (const t of snap.tasks) {
      if (!t.stageId) continue;
      if (!this.tasksByStage.has(t.stageId)) this.tasksByStage.set(t.stageId, []);
      this.tasksByStage.get(t.stageId)!.push(t);
    }
    for (const d of snap.dependencies) {
      if (!this.predecessors.has(d.successorId)) this.predecessors.set(d.successorId, []);
      this.predecessors.get(d.successorId)!.push(d);
      if (!this.successors.has(d.predecessorId)) this.successors.set(d.predecessorId, []);
      this.successors.get(d.predecessorId)!.push(d);
    }
    let critical: Set<string> | null = null;
    let note: string | null = null;
    const dated = snap.tasks.filter((t) => t.plannedStartDate);
    const projectStart = snap.project.plannedStartDate ?? dated.map((t) => t.plannedStartDate!).sort()[0];
    if (projectStart && dated.length) {
      try {
        // Status-date CPM: unfinished work can't finish in the past. Started
        // tasks run at least through today; unstarted ones start today at the earliest.
        const cal = new WorkCalendar();
        const result = computeSchedule(
          snap.tasks.map((t) => {
            let start = t.plannedStartDate;
            let duration = t.durationDays;
            if (isOpenTask(t)) {
              if (t.actualStartDate) duration = Math.max(duration, cal.workingDaysBetween(t.actualStartDate, snap.today) + 1);
              else if (start && start < snap.today) start = snap.today;
            }
            return { id: t.id, durationDays: duration, status: t.status, plannedStartDate: start, actualStartDate: t.actualStartDate, actualEndDate: t.actualEndDate };
          }),
          snap.dependencies.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type, lagDays: d.lagDays })),
          { projectStart },
        );
        critical = new Set(result.criticalPath);
        // The engine anchors started work and never marks it critical. An
        // unfinished started task that directly drives a critical successor is
        // critical for our purposes: its slip moves completion day for day.
        for (const t of snap.tasks) {
          const item = result.items.get(t.id);
          if (!item?.fixed || !isOpenTask(t)) continue;
          const drives = snap.dependencies.some((d) => {
            if (d.predecessorId !== t.id || !critical!.has(d.successorId)) return false;
            const succ = result.items.get(d.successorId)!;
            const bound = d.type === "SS" ? item.earlyStart : item.earlyEnd;
            return succ.earlyStart <= bound + (d.lagDays ?? 0);
          });
          if (drives) critical.add(t.id);
        }
      } catch (err) {
        note = err instanceof ScheduleCycleError ? err.message : "Critical path could not be computed";
      }
    } else {
      note = "No planned dates, so the critical path is unknown";
    }
    this.criticalTaskIds = critical;
    this.scheduleNote = note;
  }

  get today() {
    return this.snap.today;
  }

  daysUntil(date: string): number {
    return diffCalendarDays(this.snap.today, date);
  }

  isCritical(taskId: string): boolean {
    return this.criticalTaskIds?.has(taskId) ?? false;
  }

  name(id: string | null | undefined): string | null {
    return id ? (this.snap.names[id] ?? null) : null;
  }

  /** First stage that is neither completed nor skipped, in plan order. */
  nextStage(): Stage | null {
    return this.stages.find(isOpenStage) ?? null;
  }

  stageIndex(key: string): number {
    return this.stages.findIndex((s) => s.key === key);
  }

  /** Planned start of a stage: its own date, else the earliest planned start of its tasks. */
  stageStart(stage: Stage): string | null {
    if (stage.plannedStartDate) return stage.plannedStartDate;
    const starts = (this.tasksByStage.get(stage.id) ?? []).map((t) => t.plannedStartDate).filter((d): d is string => !!d);
    return starts.sort()[0] ?? null;
  }

  stageTasks(stageId: string): Task[] {
    return this.tasksByStage.get(stageId) ?? [];
  }

  /** Latest inspection of a type (by inspected date, then creation). */
  latestInspection(type: string): Inspection | null {
    const matches = this.snap.inspections.filter((i) => i.inspectionType === type);
    matches.sort((a, b) => (b.inspectedAt ?? b.createdAt).localeCompare(a.inspectedAt ?? a.createdAt));
    return matches[0] ?? null;
  }

  taskEvidence(t: Task, detail?: string): Evidence {
    return {
      type: "task",
      id: t.id,
      label: t.title,
      detail: detail ?? `status ${t.status}, planned ${t.plannedStartDate ?? "?"} → ${taskFinish(t) ?? "?"}`,
    };
  }

  stageEvidence(s: Stage, detail?: string): Evidence {
    return { type: "stage", id: s.id, label: s.name, detail: detail ?? `status ${s.status}, planned start ${this.stageStart(s) ?? "not set"}` };
  }

  /**
   * Whether the permit is issued, from the authoritative records: the
   * permits stage completed or its "permit issued" checklist item checked.
   */
  permitStatus(): { state: "issued" | "pending" | "unknown"; evidence: Evidence[] } {
    const evidence: Evidence[] = [];
    const permitStage = this.stageByKey.get("permits");
    const docs = this.snap.documents.filter((d) => d.category === "permit");
    const issuedItem = permitStage
      ? this.snap.checklist.find((c) => /permit/i.test(c.label) && /issued/i.test(c.label) && this.taskById.get(c.taskId)?.stageId === permitStage.id)
      : undefined;
    if (permitStage) evidence.push(this.stageEvidence(permitStage));
    if (issuedItem) evidence.push({ type: "checklist_item", id: issuedItem.id, label: issuedItem.label, detail: issuedItem.isChecked ? "checked" : "not checked" });
    for (const d of docs) evidence.push({ type: "document", id: d.id, label: d.title, detail: "permit document on file" });
    // A permit document alone isn't proof of issuance (it may be the application), so it only supports.
    if (permitStage?.status === "completed" || permitStage?.status === "skipped" || issuedItem?.isChecked) return { state: "issued", evidence };
    if (!permitStage && !issuedItem) return { state: "unknown", evidence };
    return { state: "pending", evidence };
  }
}
