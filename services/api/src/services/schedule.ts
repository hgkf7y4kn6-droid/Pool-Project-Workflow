import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  WorkCalendar,
  analyzeScheduleChange,
  computeCompletionPct,
  computeSchedule,
  findDependencyViolations,
  findResourceConflicts,
  todayISO,
  wouldCreateCycle,
  ScheduleCycleError,
  type ScheduleItem,
} from "@pool/core";
import {
  organizations,
  projectStages,
  projects,
  scheduleBaselines,
  taskDependencies,
  tasks,
  users,
  type DbOrTx,
} from "@pool/database";
import type { DependencyInput, ScheduleShiftInput } from "@pool/validation";
import type { Ctx, Deps } from "../context";
import { badRequest, notFound } from "../lib/errors";
import { loadProject, projectAccessCondition, requirePermission, taskVisibilityCondition } from "./access";
import { recordActivity } from "./activity";
import { notify } from "./notifications";

type TaskRow = typeof tasks.$inferSelect;

const calendar = new WorkCalendar();

function toScheduleItem(t: TaskRow): ScheduleItem {
  return {
    id: t.id,
    title: t.title,
    durationDays: t.isMilestone ? 0 : t.durationDays,
    status: t.status,
    plannedStartDate: t.plannedStartDate,
    actualStartDate: t.actualStartDate,
    actualEndDate: t.status === "done" ? (t.actualEndDate ?? t.plannedEndDate) : t.actualEndDate,
    resources: [t.assigneeId, t.crewTeamId].filter((r): r is string => !!r),
    weatherSensitive: t.weatherSensitive,
  };
}

async function loadGraph(db: DbOrTx, projectId: string) {
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.plannedStartDate), asc(tasks.createdAt));
  const depRows = await db
    .select()
    .from(taskDependencies)
    .where(and(eq(taskDependencies.projectId, projectId), isNull(taskDependencies.deletedAt)));
  return { taskRows, depRows };
}

/**
 * Re-derive everything computed from tasks after any change: stage status and
 * dates, completion percentage and projected completion date. Only writes
 * columns whose value actually changed (each write bumps the sync sequence).
 */
export async function recalculateProject(deps: Deps, projectId: string, db: DbOrTx = deps.db): Promise<void> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return;
  const { taskRows, depRows } = await loadGraph(db, projectId);
  const stages = await db.select().from(projectStages).where(and(eq(projectStages.projectId, projectId), isNull(projectStages.deletedAt)));

  const stageInputs = [];
  for (const stage of stages) {
    const stageTasks = taskRows.filter((t) => t.stageId === stage.id && t.status !== "cancelled");
    let status = stage.status;
    if (stage.status !== "skipped" && stageTasks.length) {
      if (stageTasks.every((t) => t.status === "done")) status = "completed";
      else if (stageTasks.some((t) => t.status !== "todo")) status = "in_progress";
      else status = "not_started";
    }
    const starts = stageTasks.map((t) => t.plannedStartDate).filter((d): d is string => !!d).sort();
    const ends = stageTasks.map((t) => t.plannedEndDate).filter((d): d is string => !!d).sort();
    const actualStarts = stageTasks.map((t) => t.actualStartDate).filter((d): d is string => !!d).sort();
    const actualEnds = stageTasks.map((t) => t.actualEndDate).filter((d): d is string => !!d).sort();
    const patch = {
      status,
      plannedStartDate: starts[0] ?? stage.plannedStartDate,
      plannedEndDate: ends.at(-1) ?? stage.plannedEndDate,
      actualStartDate: actualStarts[0] ?? (status === "not_started" ? null : stage.actualStartDate),
      actualEndDate: status === "completed" ? (actualEnds.at(-1) ?? stage.actualEndDate) : null,
    };
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => patch[k] !== stage[k]);
    if (changed) await db.update(projectStages).set(patch).where(eq(projectStages.id, stage.id));
    stageInputs.push({ key: stage.key, status: patch.status, tasks: stageTasks });
  }

  const completionPct =
    project.status === "completed" || project.status === "warranty" ? 100 : computeCompletionPct(stageInputs);

  let projectedCompletionDate = project.projectedCompletionDate;
  const dated = taskRows.filter((t) => t.plannedStartDate || t.actualStartDate);
  if (dated.length) {
    try {
      const schedule = computeSchedule(dated.map(toScheduleItem), depRows, {
        projectStart: project.plannedStartDate ?? dated.map((t) => t.plannedStartDate ?? t.actualStartDate!).sort()[0]!,
        calendar,
      });
      projectedCompletionDate = schedule.projectFinish;
    } catch (error) {
      if (!(error instanceof ScheduleCycleError)) throw error;
    }
  }
  if (completionPct !== project.completionPct || projectedCompletionDate !== project.projectedCompletionDate) {
    await db.update(projects).set({ completionPct, projectedCompletionDate }).where(eq(projects.id, projectId));
  }
}

export async function getProjectSchedule(ctx: Ctx, projectId: string) {
  const project = await loadProject(ctx, projectId);
  const { taskRows, depRows } = await loadGraph(ctx.deps.db, projectId);
  const visible = ctx.auth.role === "subcontractor" ? taskRows.filter((t) => t.assigneeId === ctx.auth.userId) : taskRows;
  const items = taskRows.map(toScheduleItem);
  const projectStart =
    project.plannedStartDate ??
    taskRows.map((t) => t.plannedStartDate).filter((d): d is string => !!d).sort()[0] ??
    todayISO();
  const schedule = computeSchedule(items, depRows, { projectStart, calendar });
  const stages = await ctx.deps.db
    .select()
    .from(projectStages)
    .where(and(eq(projectStages.projectId, projectId), isNull(projectStages.deletedAt)))
    .orderBy(asc(projectStages.sortOrder));
  const visibleIds = new Set(visible.map((t) => t.id));
  return {
    projectId,
    projectStart: schedule.projectStart,
    projectFinish: schedule.projectFinish,
    plannedCompletionDate: project.plannedCompletionDate,
    criticalPath: schedule.criticalPath.filter((id) => visibleIds.has(id)),
    tasks: visible.map((t) => {
      const s = schedule.items.get(t.id);
      return {
        id: t.id,
        title: t.title,
        stageId: t.stageId,
        status: t.status,
        assigneeId: t.assigneeId,
        crewTeamId: t.crewTeamId,
        isMilestone: t.isMilestone,
        weatherSensitive: t.weatherSensitive,
        durationDays: t.durationDays,
        plannedStartDate: t.plannedStartDate,
        plannedEndDate: t.plannedEndDate,
        actualStartDate: t.actualStartDate,
        actualEndDate: t.actualEndDate,
        earliestStartDate: s?.startDate ?? null,
        earliestFinishDate: s?.finishDate ?? null,
        totalFloatDays: s?.totalFloat ?? null,
        critical: s?.critical ?? false,
      };
    }),
    dependencies: depRows
      .filter((d) => visibleIds.has(d.predecessorId) && visibleIds.has(d.successorId))
      .map((d) => ({ id: d.id, predecessorId: d.predecessorId, successorId: d.successorId, type: d.type, lagDays: d.lagDays })),
    milestones: stages
      .filter((s) => s.isMilestone)
      .map((s) => ({ id: s.id, name: s.name, plannedDate: s.plannedEndDate ?? s.plannedStartDate, status: s.status })),
    violations: findDependencyViolations(items, depRows, calendar),
    resourceConflicts: findResourceConflicts(items, calendar),
  };
}

/**
 * Preview (default) or apply a delay/move and its downstream impact. Applying
 * is an explicit user action; weather warnings and AI suggestions only ever
 * call the preview.
 */
export async function shiftSchedule(ctx: Ctx, projectId: string, input: ScheduleShiftInput) {
  const project = await loadProject(ctx, projectId);
  if (input.apply) await requirePermission(ctx, "schedule:update");
  if (input.newStartDate === undefined && input.delayDays === undefined) {
    throw badRequest("Provide newStartDate or delayDays");
  }
  const { taskRows, depRows } = await loadGraph(ctx.deps.db, projectId);
  const target = taskRows.find((t) => t.id === input.taskId);
  if (!target) throw notFound("Task");
  const projectStart = project.plannedStartDate ?? target.plannedStartDate ?? todayISO();
  const impact = analyzeScheduleChange(
    taskRows.map(toScheduleItem),
    depRows,
    { taskId: input.taskId, newStartDate: input.newStartDate, delayDays: input.delayDays },
    { projectStart, calendar },
  );
  if (!input.apply) return { applied: false, ...impact };

  await ctx.deps.db.transaction(async (tx) => {
    for (const item of impact.impacted) {
      await tx
        .update(tasks)
        .set({
          plannedStartDate: item.proposedStart,
          plannedEndDate: item.proposedFinish,
          updatedBy: ctx.auth.userId,
        })
        .where(and(eq(tasks.id, item.id), eq(tasks.projectId, projectId)));
    }
    await recalculateProject(ctx.deps, projectId, tx);
    await recordActivity(
      ctx,
      {
        projectId,
        action: "schedule.shifted",
        entityType: "task",
        entityId: input.taskId,
        summary:
          impact.completionSlipDays !== 0
            ? `moved the schedule ${Math.abs(impact.completionSlipDays)} working day${Math.abs(impact.completionSlipDays) === 1 ? "" : "s"} ${impact.completionSlipDays > 0 ? "later" : "earlier"}${input.reason ? ` (${input.reason})` : ""}`
            : `rescheduled ${target.title}${input.reason ? ` (${input.reason})` : ""}`,
        metadata: { impacted: impact.impacted.length, slip: impact.completionSlipDays, reason: input.reason ?? null },
        clientVisible: impact.completionSlipDays !== 0,
      },
      tx,
    );
    const assignees = taskRows.filter((t) => impact.impacted.some((i) => i.id === t.id)).map((t) => t.assigneeId!);
    await notify(
      ctx.deps,
      {
        organizationId: ctx.auth.organizationId,
        userIds: assignees.filter(Boolean),
        excludeUserId: ctx.auth.userId,
        type: "schedule_changed",
        projectId,
        title: `Schedule changed: ${project.name}`,
        body: `${impact.impacted.length} task(s) moved. Projected completion ${impact.proposedFinish}.`,
      },
      tx,
    );
  });
  ctx.deps.events.publish({
    type: "schedule.changed",
    organizationId: ctx.auth.organizationId,
    projectId,
    entityType: "project",
    entityId: projectId,
  });
  return { applied: true, ...impact };
}

export async function addDependency(ctx: Ctx, projectId: string, input: DependencyInput) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "schedule:update");
  const { taskRows, depRows } = await loadGraph(ctx.deps.db, projectId);
  const ids = new Set(taskRows.map((t) => t.id));
  if (!ids.has(input.predecessorId) || !ids.has(input.successorId)) throw badRequest("Both tasks must belong to this project");
  if (wouldCreateCycle(depRows, input)) throw badRequest("This dependency would create a cycle");
  if (depRows.some((d) => d.predecessorId === input.predecessorId && d.successorId === input.successorId)) {
    throw badRequest("These tasks are already linked");
  }
  const [row] = await ctx.deps.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(taskDependencies)
      .values({ projectId, ...input, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
      .returning();
    await recalculateProject(ctx.deps, projectId, tx);
    return inserted;
  });
  return row!;
}

export async function removeDependency(ctx: Ctx, projectId: string, dependencyId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "schedule:update");
  await ctx.deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(taskDependencies)
      .set({ deletedAt: new Date().toISOString(), updatedBy: ctx.auth.userId })
      .where(and(eq(taskDependencies.id, dependencyId), eq(taskDependencies.projectId, projectId), isNull(taskDependencies.deletedAt)))
      .returning();
    if (!row) throw notFound("Dependency");
    await recalculateProject(ctx.deps, projectId, tx);
  });
}

/** Tasks across all visible projects in a date range (calendar, crew schedule). */
export async function calendarFeed(
  ctx: Ctx,
  q: { from: string; to: string; assigneeId?: string; crewTeamId?: string; projectId?: string },
) {
  const rows = await ctx.deps.db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      projectName: projects.name,
      projectNumber: projects.number,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      isMilestone: tasks.isMilestone,
      weatherSensitive: tasks.weatherSensitive,
      plannedStartDate: tasks.plannedStartDate,
      plannedEndDate: tasks.plannedEndDate,
      assigneeId: tasks.assigneeId,
      assigneeName: users.fullName,
      crewTeamId: tasks.crewTeamId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(
      and(
        projectAccessCondition(ctx),
        taskVisibilityCondition(ctx),
        isNull(tasks.deletedAt),
        sql`${tasks.status} <> 'cancelled'`,
        lte(tasks.plannedStartDate, q.to),
        or(gte(tasks.plannedEndDate, q.from), and(isNull(tasks.plannedEndDate), gte(tasks.plannedStartDate, q.from))),
        q.assigneeId ? eq(tasks.assigneeId, q.assigneeId === "me" ? ctx.auth.userId : q.assigneeId) : undefined,
        q.crewTeamId ? eq(tasks.crewTeamId, q.crewTeamId) : undefined,
        q.projectId ? eq(tasks.projectId, q.projectId) : undefined,
      ),
    )
    .orderBy(asc(tasks.plannedStartDate))
    .limit(2000);
  return rows;
}

export async function saveBaseline(ctx: Ctx, projectId: string, name: string) {
  const project = await loadProject(ctx, projectId);
  await requirePermission(ctx, "schedule:update");
  const { taskRows } = await loadGraph(ctx.deps.db, projectId);
  const [row] = await ctx.deps.db
    .insert(scheduleBaselines)
    .values({
      projectId,
      name,
      plannedCompletionDate: project.projectedCompletionDate ?? project.plannedCompletionDate,
      snapshot: taskRows.map((t) => ({ taskId: t.id, plannedStartDate: t.plannedStartDate, plannedEndDate: t.plannedEndDate })),
      createdBy: ctx.auth.userId,
    })
    .returning();
  return row!;
}

export async function listBaselines(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  return ctx.deps.db
    .select({
      id: scheduleBaselines.id,
      name: scheduleBaselines.name,
      plannedCompletionDate: scheduleBaselines.plannedCompletionDate,
      createdAt: scheduleBaselines.createdAt,
    })
    .from(scheduleBaselines)
    .where(eq(scheduleBaselines.projectId, projectId));
}

export async function organizationTimezone(db: DbOrTx, organizationId: string): Promise<string> {
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId));
  return org?.tz ?? "UTC";
}
