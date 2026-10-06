import { and, asc, desc, eq, gte, ilike, isNull, lt, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { WorkCalendar, checkTaskCompletion, todayISO, addCalendarDays } from "@pool/core";
import {
  checklistItems,
  laborEntries,
  photos,
  projectStages,
  projects,
  stageTemplates,
  taskDependencies,
  taskNotes,
  tasks,
  users,
  type DbOrTx,
} from "@pool/database";
import type { CompleteTaskInput, CreateTaskInput, TaskListQuery, UpdateTaskInput } from "@pool/validation";
import { checklistItemInput, taskNoteSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { decodeCursor, page } from "../lib/http";
import { hasPermission, loadProject, projectAccessCondition, requirePermission, taskVisibilityCondition } from "./access";
import { recordActivity } from "./activity";
import { notify, projectStakeholders } from "./notifications";
import { recalculateProject, organizationTimezone } from "./schedule";
import { strip } from "./mappers";

type TaskRow = typeof tasks.$inferSelect;
const calendar = new WorkCalendar();

/** Fields a field worker/subcontractor may change on a task assigned to them. */
const ASSIGNEE_EDITABLE = new Set(["status", "actualStartDate", "actualEndDate"]);

/** Load a task the caller can see (project access + subcontractor task scoping). */
export async function loadTask(ctx: Ctx, taskId: string, db: DbOrTx = ctx.deps.db): Promise<TaskRow> {
  const [row] = await db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt), projectAccessCondition(ctx), taskVisibilityCondition(ctx)))
    .limit(1);
  if (!row) throw notFound("Task");
  return row.task;
}

async function canEditTask(ctx: Ctx, task: TaskRow, fields: string[]): Promise<boolean> {
  if (await hasPermission(ctx, "task:update")) return true;
  if (task.assigneeId === ctx.auth.userId && (await hasPermission(ctx, "task:update_assigned"))) {
    return fields.every((f) => ASSIGNEE_EDITABLE.has(f));
  }
  return false;
}

export async function listTasks(ctx: Ctx, q: TaskListQuery) {
  const offset = decodeCursor(q.cursor);
  const tz = await organizationTimezone(ctx.deps.db, ctx.auth.organizationId);
  const today = todayISO(tz);
  const open = notInArray(tasks.status, ["done", "cancelled"]);
  const filters: (SQL | undefined)[] = [projectAccessCondition(ctx), taskVisibilityCondition(ctx), isNull(tasks.deletedAt), isNull(projects.archivedAt)];
  if (q.projectId) filters.push(eq(tasks.projectId, q.projectId));
  if (q.assigneeId) filters.push(eq(tasks.assigneeId, q.assigneeId === "me" ? ctx.auth.userId : q.assigneeId));
  if (q.status) filters.push(eq(tasks.status, q.status));
  if (q.q) filters.push(ilike(tasks.title, `%${q.q.replace(/[%_]/g, "\\$&")}%`));
  switch (q.due) {
    case "today":
      filters.push(open, lte(tasks.plannedStartDate, today), or(gte(tasks.plannedEndDate, today), isNull(tasks.plannedEndDate)));
      break;
    case "overdue":
      filters.push(open, lt(sql`coalesce(${tasks.dueDate}, ${tasks.plannedEndDate})`, today));
      break;
    case "upcoming":
      filters.push(open, gte(tasks.plannedStartDate, addCalendarDays(today, 1)), lte(tasks.plannedStartDate, addCalendarDays(today, 14)));
      break;
    case "week":
      filters.push(lte(tasks.plannedStartDate, addCalendarDays(today, 7)), or(gte(tasks.plannedEndDate, today), isNull(tasks.plannedEndDate)));
      break;
  }
  const rows = await ctx.deps.db
    .select({
      task: tasks,
      projectName: projects.name,
      assigneeName: users.fullName,
      checklistTotal: sql<number>`(select count(*)::int from ${checklistItems} ci where ci.task_id = ${tasks.id} and ci.deleted_at is null)`,
      checklistDone: sql<number>`(select count(*)::int from ${checklistItems} ci where ci.task_id = ${tasks.id} and ci.deleted_at is null and ci.is_checked)`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(...filters))
    .orderBy(asc(sql`coalesce(${tasks.plannedStartDate}, ${tasks.dueDate})`), desc(tasks.priority), asc(tasks.createdAt))
    .limit(q.limit + 1)
    .offset(offset);
  return page(
    rows.map((r) => ({
      ...strip(r.task),
      projectName: r.projectName,
      assigneeName: r.assigneeName,
      checklist: { total: r.checklistTotal, done: r.checklistDone },
      overdue: !["done", "cancelled"].includes(r.task.status) && !!(r.task.dueDate ?? r.task.plannedEndDate) && (r.task.dueDate ?? r.task.plannedEndDate)! < today,
    })),
    q.limit,
    offset,
  );
}

export async function getTask(ctx: Ctx, taskId: string) {
  const task = await loadTask(ctx, taskId);
  const db = ctx.deps.db;
  const checklist = await db
    .select({
      item: checklistItems,
      photoCount: sql<number>`(select count(*)::int from ${photos} p where p.checklist_item_id = ${checklistItems.id} and p.deleted_at is null)`,
    })
    .from(checklistItems)
    .where(and(eq(checklistItems.taskId, taskId), isNull(checklistItems.deletedAt)))
    .orderBy(asc(checklistItems.sortOrder));
  const notes = await db
    .select({ note: taskNotes, authorName: users.fullName })
    .from(taskNotes)
    .leftJoin(users, eq(users.id, taskNotes.createdBy))
    .where(and(eq(taskNotes.taskId, taskId), isNull(taskNotes.deletedAt)))
    .orderBy(desc(taskNotes.createdAt));
  const predecessors = await db
    .select({ id: taskDependencies.id, taskId: tasks.id, title: tasks.title, status: tasks.status, type: taskDependencies.type, lagDays: taskDependencies.lagDays })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.predecessorId))
    .where(and(eq(taskDependencies.successorId, taskId), isNull(taskDependencies.deletedAt)));
  const successors = await db
    .select({ id: taskDependencies.id, taskId: tasks.id, title: tasks.title, status: tasks.status, type: taskDependencies.type, lagDays: taskDependencies.lagDays })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.successorId))
    .where(and(eq(taskDependencies.predecessorId, taskId), isNull(taskDependencies.deletedAt)));
  const [labor] = await db
    .select({ hours: sql<number>`coalesce(sum(${laborEntries.hours}), 0)::float` })
    .from(laborEntries)
    .where(and(eq(laborEntries.taskId, taskId), isNull(laborEntries.deletedAt)));
  const [photoCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(photos)
    .where(and(eq(photos.taskId, taskId), isNull(photos.deletedAt)));
  const [assignee] = task.assigneeId
    ? await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, task.assigneeId))
    : [];
  const [stage] = task.stageId ? await db.select({ name: projectStages.name, key: projectStages.key }).from(projectStages).where(eq(projectStages.id, task.stageId)) : [];
  return {
    ...strip(task),
    assigneeName: assignee?.fullName ?? null,
    stageName: stage?.name ?? null,
    stageKey: stage?.key ?? null,
    checklist: checklist.map((c) => ({ ...strip(c.item), photoCount: c.photoCount })),
    notes: notes
      .filter((n) => ctx.auth.role !== "client" || n.note.visibility === "client")
      .map((n) => ({ ...strip(n.note), authorName: n.authorName })),
    predecessors,
    successors,
    laborHours: labor?.hours ?? 0,
    photoCount: photoCount?.n ?? 0,
  };
}

export async function createTask(ctx: Ctx, projectId: string, input: CreateTaskInput, db: DbOrTx = ctx.deps.db) {
  const project = await loadProject(ctx, projectId, db);
  await requirePermission(ctx, "task:create");
  if (input.assigneeId && input.assigneeId !== ctx.auth.userId) await requirePermission(ctx, "task:assign");
  const plannedEnd =
    input.plannedEndDate ?? (input.plannedStartDate ? calendar.finishDate(input.plannedStartDate, input.isMilestone ? 0 : input.durationDays) : null);

  let checklist = input.checklist;
  if (!checklist.length && input.checklistTemplateKey) {
    const [tpl] = await db
      .select()
      .from(stageTemplates)
      .where(and(eq(stageTemplates.organizationId, ctx.auth.organizationId), eq(stageTemplates.key, input.checklistTemplateKey)));
    checklist = (tpl?.checklist ?? []).map((c) => ({ label: c.label, required: c.required, requiresPhoto: !!c.requiresPhoto }));
  }

  const run = async (tx: DbOrTx) => {
    const { checklist: _c, checklistTemplateKey: _k, id, ...values } = input;
    if (values.stageId) {
      const [st] = await tx.select({ id: projectStages.id }).from(projectStages).where(and(eq(projectStages.id, values.stageId), eq(projectStages.projectId, projectId)));
      if (!st) throw badRequest("Stage does not belong to this project");
    }
    const [task] = await tx
      .insert(tasks)
      .values({
        ...(id ? { id } : {}),
        ...values,
        plannedEndDate: plannedEnd,
        dueDate: values.dueDate ?? plannedEnd,
        projectId,
        createdBy: ctx.auth.userId,
        updatedBy: ctx.auth.userId,
      })
      .returning();
    if (checklist.length) {
      await tx.insert(checklistItems).values(
        checklist.map((c, i) => ({
          ...(c.id ? { id: c.id } : {}),
          taskId: task!.id,
          projectId,
          label: c.label,
          required: c.required,
          requiresPhoto: c.requiresPhoto,
          sortOrder: i,
          createdBy: ctx.auth.userId,
        })),
      );
    }
    await recordActivity(ctx, { projectId, action: "task.created", entityType: "task", entityId: task!.id, summary: `created task ${task!.title}` }, tx);
    if (task!.assigneeId) {
      await notify(
        ctx.deps,
        {
          organizationId: ctx.auth.organizationId,
          userIds: [task!.assigneeId],
          excludeUserId: ctx.auth.userId,
          type: "task_assigned",
          projectId,
          title: "New task assigned",
          body: `${task!.title} — ${project.name}`,
          data: { taskId: task!.id },
        },
        tx,
      );
    }
    await recalculateProject(ctx.deps, projectId, tx);
    return task!;
  };
  const task = db === ctx.deps.db ? await ctx.deps.db.transaction(run) : await run(db);
  ctx.deps.events.publish({ type: "task.created", organizationId: ctx.auth.organizationId, projectId, entityType: "task", entityId: task.id });
  return strip(task);
}

/**
 * Apply a task update (REST and offline sync share this path). Status "done"
 * is routed through the completion rules so checklists are always enforced.
 */
export async function applyTaskUpdate(
  ctx: Ctx,
  task: TaskRow,
  input: UpdateTaskInput & { override?: boolean; overrideReason?: string | null },
  db: DbOrTx,
): Promise<TaskRow> {
  const { expectedVersion, override, overrideReason, ...patch } = input;
  const fields = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (!(await canEditTask(ctx, task, fields))) throw forbidden("You can only update the status of tasks assigned to you");
  if (expectedVersion !== undefined && expectedVersion !== task.version) {
    throw conflict("This task was changed by someone else", { currentVersion: task.version });
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId) await requirePermission(ctx, "task:assign");

  const tz = await organizationTimezone(db, ctx.auth.organizationId);
  const today = todayISO(tz);
  const set: Partial<typeof tasks.$inferInsert> = { ...patch, updatedBy: ctx.auth.userId };

  if (patch.plannedStartDate !== undefined && patch.plannedEndDate === undefined && patch.plannedStartDate) {
    set.plannedEndDate = calendar.finishDate(patch.plannedStartDate, patch.durationDays ?? task.durationDays);
  }
  if (patch.status === "in_progress" && !task.actualStartDate && patch.actualStartDate === undefined) set.actualStartDate = today;
  if (patch.status === "done" && task.status !== "done") {
    const items = await db
      .select({
        id: checklistItems.id,
        label: checklistItems.label,
        required: checklistItems.required,
        requiresPhoto: checklistItems.requiresPhoto,
        isChecked: checklistItems.isChecked,
        photoCount: sql<number>`(select count(*)::int from ${photos} p where p.checklist_item_id = ${checklistItems.id} and p.deleted_at is null)`,
      })
      .from(checklistItems)
      .where(and(eq(checklistItems.taskId, task.id), isNull(checklistItems.deletedAt)));
    const check = checkTaskCompletion(items, ctx.auth.role, { override, overrideReason });
    if (!check.allowed) {
      throw new AppError(
        check.reason === "override_not_permitted" ? "forbidden" : "precondition_failed",
        check.reason === "checklist_incomplete"
          ? `Complete the required checklist items first: ${[...check.blockingItems, ...check.missingPhotos].map((i) => i.label).join(", ")}`
          : check.reason === "override_reason_required"
            ? "Give a reason for completing with open checklist items"
            : "You are not allowed to override required checklist items",
        undefined,
        { blockingItems: check.blockingItems.map((i) => i.id), missingPhotos: check.missingPhotos.map((i) => i.id) },
      );
    }
    set.completedAt = new Date().toISOString();
    set.completedBy = ctx.auth.userId;
    set.actualEndDate = patch.actualEndDate ?? today;
    if (!task.actualStartDate && !patch.actualStartDate) set.actualStartDate = task.plannedStartDate && task.plannedStartDate <= today ? task.plannedStartDate : today;
    if (check.overridden) set.completionOverrideReason = overrideReason ?? null;
  }
  if (patch.status && patch.status !== "done" && task.status === "done") {
    set.completedAt = null;
    set.completedBy = null;
    set.actualEndDate = null;
  }

  const [updated] = await db.update(tasks).set(set).where(eq(tasks.id, task.id)).returning();

  if (patch.status === "done" && task.status !== "done") {
    await recordActivity(
      ctx,
      {
        projectId: task.projectId,
        action: "task.completed",
        entityType: "task",
        entityId: task.id,
        summary: `completed ${task.title}${set.completionOverrideReason ? ` (checklist override: ${set.completionOverrideReason})` : ""}`,
        clientVisible: !!task.stageId,
        metadata: set.completionOverrideReason ? { override: true, reason: set.completionOverrideReason } : {},
      },
      db,
    );
    if (task.isMilestone) {
      await notify(
        ctx.deps,
        {
          organizationId: ctx.auth.organizationId,
          userIds: await projectStakeholders(db, task.projectId),
          excludeUserId: ctx.auth.userId,
          type: "milestone_completed",
          projectId: task.projectId,
          title: "Milestone completed",
          body: task.title,
          data: { taskId: task.id },
        },
        db,
      );
    }
  } else {
    await recordActivity(
      ctx,
      { projectId: task.projectId, action: patch.assigneeId ? "task.assigned" : "task.updated", entityType: "task", entityId: task.id, summary: `updated ${task.title}`, metadata: { fields } },
      db,
    );
  }
  if (patch.assigneeId && patch.assigneeId !== task.assigneeId) {
    await notify(
      ctx.deps,
      {
        organizationId: ctx.auth.organizationId,
        userIds: [patch.assigneeId],
        excludeUserId: ctx.auth.userId,
        type: "task_assigned",
        projectId: task.projectId,
        title: "New task assigned",
        body: task.title,
        data: { taskId: task.id },
      },
      db,
    );
  }
  await recalculateProject(ctx.deps, task.projectId, db);
  ctx.deps.events.publish({ type: "task.updated", organizationId: ctx.auth.organizationId, projectId: task.projectId, entityType: "task", entityId: task.id });
  return updated!;
}

export async function updateTask(ctx: Ctx, taskId: string, input: UpdateTaskInput) {
  await ctx.deps.db.transaction(async (tx) => {
    const task = await loadTask(ctx, taskId, tx);
    await applyTaskUpdate(ctx, task, input, tx);
  });
  return getTask(ctx, taskId);
}

export async function completeTask(ctx: Ctx, taskId: string, input: CompleteTaskInput) {
  await ctx.deps.db.transaction(async (tx) => {
    const task = await loadTask(ctx, taskId, tx);
    await applyTaskUpdate(ctx, task, { status: "done", actualEndDate: input.actualEndDate, override: input.override, overrideReason: input.overrideReason }, tx);
  });
  return getTask(ctx, taskId);
}

export async function deleteTask(ctx: Ctx, taskId: string) {
  const task = await loadTask(ctx, taskId);
  await requirePermission(ctx, "task:delete");
  await ctx.deps.db.transaction(async (tx) => {
    const now = new Date().toISOString();
    await tx.update(tasks).set({ deletedAt: now, updatedBy: ctx.auth.userId }).where(eq(tasks.id, taskId));
    await tx
      .update(taskDependencies)
      .set({ deletedAt: now })
      .where(and(or(eq(taskDependencies.predecessorId, taskId), eq(taskDependencies.successorId, taskId)), isNull(taskDependencies.deletedAt)));
    await recalculateProject(ctx.deps, task.projectId, tx);
  });
}

// --- Checklist ----------------------------------------------------------------------

export async function addChecklistItem(ctx: Ctx, taskId: string, input: z.infer<typeof checklistItemInput>) {
  const task = await loadTask(ctx, taskId);
  await requirePermission(ctx, "task:update");
  const [{ max } = { max: -1 }] = await ctx.deps.db
    .select({ max: sql<number>`coalesce(max(${checklistItems.sortOrder}), -1)::int` })
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId));
  const [row] = await ctx.deps.db
    .insert(checklistItems)
    .values({ ...(input.id ? { id: input.id } : {}), taskId, projectId: task.projectId, label: input.label, required: input.required, requiresPhoto: input.requiresPhoto, sortOrder: max + 1, createdBy: ctx.auth.userId })
    .returning();
  return strip(row!);
}

export async function applyChecklistToggle(ctx: Ctx, itemId: string, isChecked: boolean, db: DbOrTx, expectedVersion?: number) {
  const [item] = await db.select().from(checklistItems).where(and(eq(checklistItems.id, itemId), isNull(checklistItems.deletedAt)));
  if (!item) throw notFound("Checklist item");
  const task = await loadTask(ctx, item.taskId, db);
  if (!(await canEditTask(ctx, task, ["status"]))) throw forbidden();
  if (expectedVersion !== undefined && expectedVersion !== item.version) throw conflict("Checklist item changed", { currentVersion: item.version });
  const [row] = await db
    .update(checklistItems)
    .set({
      isChecked,
      checkedAt: isChecked ? new Date().toISOString() : null,
      checkedBy: isChecked ? ctx.auth.userId : null,
      updatedBy: ctx.auth.userId,
    })
    .where(eq(checklistItems.id, itemId))
    .returning();
  ctx.deps.events.publish({ type: "task.updated", organizationId: ctx.auth.organizationId, projectId: task.projectId, entityType: "task", entityId: task.id });
  return row!;
}

export async function toggleChecklistItem(ctx: Ctx, itemId: string, isChecked: boolean, expectedVersion?: number) {
  const row = await ctx.deps.db.transaction((tx) => applyChecklistToggle(ctx, itemId, isChecked, tx, expectedVersion));
  return strip(row);
}

export async function deleteChecklistItem(ctx: Ctx, itemId: string) {
  const [item] = await ctx.deps.db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
  if (!item) throw notFound("Checklist item");
  await loadTask(ctx, item.taskId);
  await requirePermission(ctx, "task:update");
  await ctx.deps.db.update(checklistItems).set({ deletedAt: new Date().toISOString() }).where(eq(checklistItems.id, itemId));
}

// --- Notes & problem reports ----------------------------------------------------------

export async function addTaskNote(ctx: Ctx, taskId: string, input: z.infer<typeof taskNoteSchema>, db: DbOrTx = ctx.deps.db) {
  const task = await loadTask(ctx, taskId, db);
  if (ctx.auth.role === "client") throw forbidden();
  const [note] = await db
    .insert(taskNotes)
    .values({
      ...(input.id ? { id: input.id } : {}),
      taskId,
      projectId: task.projectId,
      body: input.body,
      isProblem: input.isProblem,
      visibility: input.visibility,
      createdBy: ctx.auth.userId,
      updatedBy: ctx.auth.userId,
    })
    .returning();
  if (input.isProblem) {
    if (task.status !== "done") await db.update(tasks).set({ status: "blocked", updatedBy: ctx.auth.userId }).where(eq(tasks.id, taskId));
    await recordActivity(
      ctx,
      { projectId: task.projectId, action: "task.problem_reported", entityType: "task", entityId: taskId, summary: `reported a problem on ${task.title}: ${input.body.slice(0, 120)}` },
      db,
    );
    await notify(
      ctx.deps,
      {
        organizationId: ctx.auth.organizationId,
        userIds: await projectStakeholders(db, task.projectId),
        excludeUserId: ctx.auth.userId,
        type: "message_received",
        projectId: task.projectId,
        title: `Problem reported: ${task.title}`,
        body: input.body.slice(0, 200),
        data: { taskId },
      },
      db,
    );
  }
  ctx.deps.events.publish({ type: "task.updated", organizationId: ctx.auth.organizationId, projectId: task.projectId, entityType: "task", entityId: taskId });
  return strip(note!);
}

/** Overdue scan (worker job): notify assignees once per task per day. */
export async function scanOverdueTasks(deps: Ctx["deps"]): Promise<number> {
  const today = todayISO();
  const rows = await deps.db
    .select({ id: tasks.id, title: tasks.title, assigneeId: tasks.assigneeId, projectId: tasks.projectId, organizationId: projects.organizationId, projectName: projects.name })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        isNull(tasks.deletedAt),
        notInArray(tasks.status, ["done", "cancelled"]),
        lt(sql`coalesce(${tasks.dueDate}, ${tasks.plannedEndDate})`, today),
        ne(projects.status, "cancelled"),
        isNull(projects.archivedAt),
      ),
    )
    .limit(5000);
  let sent = 0;
  for (const t of rows) {
    if (!t.assigneeId) continue;
    const created = await notify(deps, {
      organizationId: t.organizationId,
      userIds: [t.assigneeId],
      type: "task_overdue",
      projectId: t.projectId,
      title: "Task overdue",
      body: `${t.title} — ${t.projectName}`,
      data: { taskId: t.id },
      dedupeKey: `overdue:${t.id}:${today}`,
    });
    sent += created.length;
  }
  return sent;
}
