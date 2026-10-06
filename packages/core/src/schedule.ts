import type { DependencyType, TaskStatus } from "@pool/types";
import { WorkCalendar } from "./calendar";

/**
 * Construction scheduling engine.
 *
 * Model: every schedulable item occupies the half-open working-day interval
 * [start, start + duration) in "working-day index" space. A milestone has a
 * duration of 0. Dependencies constrain boundaries:
 *
 *   FS  successor.start  >= predecessor.end   + lag
 *   SS  successor.start  >= predecessor.start + lag
 *   FF  successor.end    >= predecessor.end   + lag
 *
 * The forward pass computes the earliest dates, the backward pass computes
 * the latest dates, and their difference is total float. Items with zero
 * float form the critical path.
 */

export interface ScheduleItem {
  id: string;
  title?: string;
  durationDays: number;
  status?: TaskStatus;
  /** "Start no earlier than" constraint, usually the currently planned start. */
  plannedStartDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  /** Resource keys (user id, crew id) used for over-allocation detection. */
  resources?: string[];
  weatherSensitive?: boolean;
}

export interface ScheduleDependency {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays?: number;
}

export interface ScheduledItem {
  id: string;
  startDate: string;
  finishDate: string;
  earlyStart: number;
  earlyEnd: number;
  lateStart: number;
  lateEnd: number;
  totalFloat: number;
  critical: boolean;
  fixed: boolean;
}

export interface ScheduleResult {
  items: Map<string, ScheduledItem>;
  order: string[];
  projectStart: string;
  projectFinish: string;
  criticalPath: string[];
}

export class ScheduleCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Dependency cycle detected: ${cycle.join(" → ")}`);
    this.name = "ScheduleCycleError";
  }
}

const isClosed = (status?: TaskStatus) => status === "cancelled";

/** Kahn topological sort; throws ScheduleCycleError with one offending cycle. */
export function topologicalOrder(ids: string[], deps: ScheduleDependency[]): string[] {
  const idSet = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const d of deps) {
    if (!idSet.has(d.predecessorId) || !idSet.has(d.successorId)) continue;
    out.get(d.predecessorId)!.push(d.successorId);
    indegree.set(d.successorId, (indegree.get(d.successorId) ?? 0) + 1);
  }
  // Stable order: keep input order among ready nodes.
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id)!) {
      const n = indegree.get(next)! - 1;
      indegree.set(next, n);
      if (n === 0) queue.push(next);
    }
  }
  if (order.length !== ids.length) {
    throw new ScheduleCycleError(findCycle(ids.filter((id) => indegree.get(id)! > 0), out));
  }
  return order;
}

function findCycle(candidates: string[], out: Map<string, string[]>): string[] {
  const remaining = new Set(candidates);
  const visiting: string[] = [];
  const onStack = new Set<string>();
  const done = new Set<string>();
  const dfs = (id: string): string[] | null => {
    visiting.push(id);
    onStack.add(id);
    for (const next of out.get(id) ?? []) {
      if (!remaining.has(next) || done.has(next)) continue;
      if (onStack.has(next)) return [...visiting.slice(visiting.indexOf(next)), next];
      const found = dfs(next);
      if (found) return found;
    }
    visiting.pop();
    onStack.delete(id);
    done.add(id);
    return null;
  };
  for (const id of candidates) {
    if (done.has(id)) continue;
    const cycle = dfs(id);
    if (cycle) return cycle;
  }
  return candidates;
}

/** Would adding `candidate` introduce a cycle? */
export function wouldCreateCycle(
  deps: ScheduleDependency[],
  candidate: Pick<ScheduleDependency, "predecessorId" | "successorId">,
): boolean {
  if (candidate.predecessorId === candidate.successorId) return true;
  // A cycle appears iff the successor can already reach the predecessor.
  const out = new Map<string, string[]>();
  for (const d of deps) {
    if (!out.has(d.predecessorId)) out.set(d.predecessorId, []);
    out.get(d.predecessorId)!.push(d.successorId);
  }
  const stack = [candidate.successorId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === candidate.predecessorId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(out.get(id) ?? []));
  }
  return false;
}

/** Converts between dates and dense working-day indexes relative to an anchor. */
class IndexSpace {
  private readonly anchor: string;
  constructor(
    private readonly calendar: WorkCalendar,
    anchor: string,
  ) {
    this.anchor = calendar.nextWorkingDay(anchor);
  }
  toIndex(date: string): number {
    return this.calendar.workingDaysBetween(this.anchor, date);
  }
  toDate(index: number): string {
    return this.calendar.addWorkingDays(this.anchor, index);
  }
}

export interface ComputeScheduleOptions {
  projectStart: string;
  calendar?: WorkCalendar;
}

export function computeSchedule(
  items: ScheduleItem[],
  dependencies: ScheduleDependency[],
  options: ComputeScheduleOptions,
): ScheduleResult {
  const calendar = options.calendar ?? new WorkCalendar();
  const active = items.filter((i) => !isClosed(i.status));
  const byId = new Map(active.map((i) => [i.id, i]));
  const deps = dependencies.filter((d) => byId.has(d.predecessorId) && byId.has(d.successorId));
  const order = topologicalOrder(
    active.map((i) => i.id),
    deps,
  );

  // Anchor at the earliest relevant date so indexes are non-negative in practice.
  const candidateDates = [options.projectStart];
  for (const i of active) {
    if (i.actualStartDate) candidateDates.push(i.actualStartDate);
    if (i.plannedStartDate) candidateDates.push(i.plannedStartDate);
  }
  const anchor = candidateDates.sort()[0]!;
  const space = new IndexSpace(calendar, anchor);
  const projectStartIdx = space.toIndex(options.projectStart);

  const preds = new Map<string, ScheduleDependency[]>();
  const succs = new Map<string, ScheduleDependency[]>();
  for (const d of deps) {
    if (!preds.has(d.successorId)) preds.set(d.successorId, []);
    preds.get(d.successorId)!.push(d);
    if (!succs.has(d.predecessorId)) succs.set(d.predecessorId, []);
    succs.get(d.predecessorId)!.push(d);
  }

  const es = new Map<string, number>();
  const ee = new Map<string, number>();
  const fixed = new Map<string, boolean>();

  // Forward pass.
  for (const id of order) {
    const item = byId.get(id)!;
    const duration = Math.max(0, Math.round(item.durationDays));
    if (item.actualStartDate) {
      // Work that has already started is anchored to reality.
      const start = space.toIndex(item.actualStartDate);
      const end = item.actualEndDate ? space.toIndex(item.actualEndDate) + 1 : start + duration;
      es.set(id, start);
      ee.set(id, Math.max(end, start));
      fixed.set(id, true);
      continue;
    }
    let start = item.plannedStartDate ? space.toIndex(item.plannedStartDate) : projectStartIdx;
    for (const d of preds.get(id) ?? []) {
      const lag = d.lagDays ?? 0;
      const pStart = es.get(d.predecessorId)!;
      const pEnd = ee.get(d.predecessorId)!;
      const required =
        d.type === "FS" ? pEnd + lag : d.type === "SS" ? pStart + lag : pEnd + lag - duration;
      start = Math.max(start, required);
    }
    es.set(id, start);
    ee.set(id, start + duration);
    fixed.set(id, false);
  }

  const projectEnd = Math.max(projectStartIdx, ...order.map((id) => ee.get(id)!));

  // Backward pass.
  const ls = new Map<string, number>();
  const le = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const item = byId.get(id)!;
    const duration = Math.max(0, Math.round(item.durationDays));
    let lateEnd = projectEnd;
    for (const d of succs.get(id) ?? []) {
      const lag = d.lagDays ?? 0;
      const sLs = ls.get(d.successorId)!;
      const sLe = le.get(d.successorId)!;
      const bound = d.type === "FS" ? sLs - lag : d.type === "SS" ? sLs - lag + duration : sLe - lag;
      lateEnd = Math.min(lateEnd, bound);
    }
    if (fixed.get(id)) {
      ls.set(id, es.get(id)!);
      le.set(id, ee.get(id)!);
    } else {
      le.set(id, lateEnd);
      ls.set(id, lateEnd - duration);
    }
  }

  const result = new Map<string, ScheduledItem>();
  for (const id of order) {
    const start = es.get(id)!;
    const end = ee.get(id)!;
    const totalFloat = ls.get(id)! - start;
    result.set(id, {
      id,
      startDate: space.toDate(start),
      finishDate: space.toDate(Math.max(start, end - 1)),
      earlyStart: start,
      earlyEnd: end,
      lateStart: ls.get(id)!,
      lateEnd: le.get(id)!,
      totalFloat,
      critical: !fixed.get(id) && totalFloat <= 0,
      fixed: fixed.get(id)!,
    });
  }

  return {
    items: result,
    order,
    projectStart: space.toDate(projectStartIdx),
    // A trailing milestone sits on its start boundary, so take the latest displayed finish.
    projectFinish: space.toDate(
      Math.max(projectStartIdx, ...order.map((id) => Math.max(es.get(id)!, ee.get(id)! - 1))),
    ),
    criticalPath: order.filter((id) => result.get(id)!.critical),
  };
}

export interface ScheduleChange {
  taskId: string;
  /** New planned start for the task. */
  newStartDate?: string;
  /** Or: push the task by this many working days (negative pulls it in). */
  delayDays?: number;
  /** Optionally change the task's duration at the same time. */
  newDurationDays?: number;
}

export interface ImpactedItem {
  id: string;
  title?: string;
  previousStart: string | null;
  previousFinish: string | null;
  proposedStart: string;
  proposedFinish: string;
  shiftDays: number;
  critical: boolean;
}

export interface ScheduleImpact {
  changedTaskId: string;
  impacted: ImpactedItem[];
  previousFinish: string | null;
  proposedFinish: string;
  /** Working days the projected completion slips (negative = earlier). */
  completionSlipDays: number;
}

/**
 * Compute the downstream impact of delaying (or moving) one task.
 *
 * Every unaffected task keeps its current planned start as a "no earlier than"
 * constraint, so nothing is ever pulled earlier automatically and only real
 * knock-on effects show up. The result is a proposal; callers must ask the user
 * before applying it.
 */
export function analyzeScheduleChange(
  items: ScheduleItem[],
  dependencies: ScheduleDependency[],
  change: ScheduleChange,
  options: ComputeScheduleOptions,
): ScheduleImpact {
  const calendar = options.calendar ?? new WorkCalendar();
  const target = items.find((i) => i.id === change.taskId);
  if (!target) throw new Error(`Unknown task ${change.taskId}`);

  const baseline = computeSchedule(items, dependencies, { ...options, calendar });
  const baseTarget = baseline.items.get(target.id);
  const currentStart = target.plannedStartDate ?? baseTarget?.startDate ?? options.projectStart;
  const newStart =
    change.newStartDate ??
    (change.delayDays !== undefined ? calendar.addWorkingDays(currentStart, change.delayDays) : currentStart);

  const modified = items.map((i) =>
    i.id === target.id
      ? { ...i, plannedStartDate: newStart, durationDays: change.newDurationDays ?? i.durationDays }
      : i,
  );
  // Dependencies still win: the forward pass never lets the moved task start
  // before its predecessors allow.
  const proposed = computeSchedule(modified, dependencies, { ...options, calendar });

  const impacted: ImpactedItem[] = [];
  for (const id of proposed.order) {
    const p = proposed.items.get(id)!;
    const item = items.find((i) => i.id === id)!;
    const prevStart = item.plannedStartDate ?? baseline.items.get(id)?.startDate ?? null;
    const prevFinish = prevStart
      ? calendar.finishDate(prevStart, item.durationDays)
      : (baseline.items.get(id)?.finishDate ?? null);
    if (prevStart !== p.startDate || prevFinish !== p.finishDate) {
      impacted.push({
        id,
        title: item.title,
        previousStart: prevStart,
        previousFinish: prevFinish,
        proposedStart: p.startDate,
        proposedFinish: p.finishDate,
        shiftDays: prevStart ? calendar.workingDaysBetween(prevStart, p.startDate) : 0,
        critical: p.critical,
      });
    }
  }

  return {
    changedTaskId: target.id,
    impacted,
    previousFinish: baseline.projectFinish,
    proposedFinish: proposed.projectFinish,
    completionSlipDays: calendar.workingDaysBetween(baseline.projectFinish, proposed.projectFinish),
  };
}

export interface DependencyViolation {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  /** Working days the successor must move to satisfy the dependency. */
  requiredShiftDays: number;
}

/** Find planned dates that break their dependencies (e.g. after manual edits). */
export function findDependencyViolations(
  items: ScheduleItem[],
  dependencies: ScheduleDependency[],
  calendar: WorkCalendar = new WorkCalendar(),
): DependencyViolation[] {
  const byId = new Map(items.filter((i) => !isClosed(i.status)).map((i) => [i.id, i]));
  const violations: DependencyViolation[] = [];
  for (const d of dependencies) {
    const p = byId.get(d.predecessorId);
    const s = byId.get(d.successorId);
    if (!p?.plannedStartDate || !s?.plannedStartDate) continue;
    if (s.actualStartDate) continue; // already started: history, not a plan
    const lag = d.lagDays ?? 0;
    const pStart = p.actualStartDate ?? p.plannedStartDate;
    const pEndBoundary = p.actualEndDate
      ? calendar.addWorkingDays(p.actualEndDate, 1)
      : calendar.addWorkingDays(pStart, p.durationDays);
    const sDuration = s.durationDays;
    let requiredStart: string;
    if (d.type === "FS") requiredStart = calendar.addWorkingDays(pEndBoundary, lag);
    else if (d.type === "SS") requiredStart = calendar.addWorkingDays(pStart, lag);
    else requiredStart = calendar.addWorkingDays(pEndBoundary, lag - sDuration);
    const shift = calendar.workingDaysBetween(s.plannedStartDate, requiredStart);
    if (shift > 0) {
      violations.push({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type, requiredShiftDays: shift });
    }
  }
  return violations;
}

export interface ResourceConflict {
  resource: string;
  date: string;
  taskIds: string[];
}

/** Detect a crew/user assigned to overlapping work on the same day. */
export function findResourceConflicts(
  items: ScheduleItem[],
  calendar: WorkCalendar = new WorkCalendar(),
  maxDays = 730,
): ResourceConflict[] {
  const usage = new Map<string, string[]>();
  for (const item of items) {
    if (isClosed(item.status) || item.status === "done" || !item.plannedStartDate) continue;
    const days = Math.min(Math.max(item.durationDays, 1), maxDays);
    for (let n = 0; n < days; n += 1) {
      const date = calendar.addWorkingDays(item.plannedStartDate, n);
      for (const r of item.resources ?? []) {
        const key = `${r}|${date}`;
        if (!usage.has(key)) usage.set(key, []);
        usage.get(key)!.push(item.id);
      }
    }
  }
  const conflicts: ResourceConflict[] = [];
  for (const [key, taskIds] of usage) {
    if (taskIds.length < 2) continue;
    const [resource, date] = key.split("|") as [string, string];
    conflicts.push({ resource, date, taskIds });
  }
  return conflicts.sort((a, b) => a.date.localeCompare(b.date));
}
