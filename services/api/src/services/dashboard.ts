import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { ACTIVE_PROJECT_STATUSES } from "@pool/types";
import { addCalendarDays, todayISO } from "@pool/core";
import {
  activityLogs,
  approvals,
  photos,
  projects,
  tasks,
  users,
  weatherAlerts,
} from "@pool/database";
import type { Ctx } from "../context";
import { accessibleProjectIds, hasPermission, isInternal, loadProject, taskVisibilityCondition } from "./access";
import { computeProjectBudget } from "./budget";
import { pendingChangeOrders } from "./change-orders";
import { organizationTimezone } from "./schedule";

/**
 * Company dashboard: what needs attention today across every project the
 * user can see. Each section is a bounded query (no full-table loads).
 */
export async function companyDashboard(ctx: Ctx) {
  const db = ctx.deps.db;
  const tz = await organizationTimezone(db, ctx.auth.organizationId);
  const today = todayISO(tz);
  const projectIds = await accessibleProjectIds(ctx);
  const none = projectIds.length === 0;
  const inVisible = none ? sql`false` : inArray(tasks.projectId, projectIds);
  const internal = isInternal(ctx);

  const activeProjects = none
    ? []
    : await db
        .select({
          id: projects.id,
          number: projects.number,
          name: projects.name,
          status: projects.status,
          completionPct: projects.completionPct,
          plannedCompletionDate: projects.plannedCompletionDate,
          projectedCompletionDate: projects.projectedCompletionDate,
        })
        .from(projects)
        .where(and(inArray(projects.id, projectIds), inArray(projects.status, [...ACTIVE_PROJECT_STATUSES]), isNull(projects.archivedAt)))
        .orderBy(asc(projects.projectedCompletionDate));

  const taskBase = {
    id: tasks.id,
    title: tasks.title,
    projectId: tasks.projectId,
    projectName: projects.name,
    status: tasks.status,
    priority: tasks.priority,
    plannedStartDate: tasks.plannedStartDate,
    plannedEndDate: tasks.plannedEndDate,
    dueDate: tasks.dueDate,
    assigneeId: tasks.assigneeId,
    assigneeName: users.fullName,
    weatherSensitive: tasks.weatherSensitive,
  };
  const open = notInArray(tasks.status, ["done", "cancelled"]);
  const mine = ctx.auth.role === "field_worker" || ctx.auth.role === "subcontractor" ? eq(tasks.assigneeId, ctx.auth.userId) : undefined;

  const [todaysSchedule, upcoming, overdue] = internal || ctx.auth.role === "subcontractor"
    ? await Promise.all([
        db
          .select(taskBase)
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .leftJoin(users, eq(users.id, tasks.assigneeId))
          .where(and(inVisible, isNull(tasks.deletedAt), open, mine, taskVisibilityCondition(ctx), lte(tasks.plannedStartDate, today), or(gte(tasks.plannedEndDate, today), isNull(tasks.plannedEndDate))))
          .orderBy(desc(tasks.priority), asc(tasks.plannedStartDate))
          .limit(50),
        db
          .select(taskBase)
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .leftJoin(users, eq(users.id, tasks.assigneeId))
          .where(and(inVisible, isNull(tasks.deletedAt), open, mine, taskVisibilityCondition(ctx), gte(tasks.plannedStartDate, addCalendarDays(today, 1)), lte(tasks.plannedStartDate, addCalendarDays(today, 7))))
          .orderBy(asc(tasks.plannedStartDate))
          .limit(30),
        db
          .select(taskBase)
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .leftJoin(users, eq(users.id, tasks.assigneeId))
          .where(and(inVisible, isNull(tasks.deletedAt), open, mine, taskVisibilityCondition(ctx), lt(sql`coalesce(${tasks.dueDate}, ${tasks.plannedEndDate})`, today)))
          .orderBy(asc(sql`coalesce(${tasks.dueDate}, ${tasks.plannedEndDate})`))
          .limit(30),
      ])
    : [[], [], []];

  const recentActivity = none
    ? []
    : await db
        .select()
        .from(activityLogs)
        .where(and(inArray(activityLogs.projectId, projectIds), internal ? undefined : eq(activityLogs.clientVisible, true)))
        .orderBy(desc(activityLogs.createdAt))
        .limit(15);

  const outstandingApprovals = none
    ? []
    : await db
        .select({ id: approvals.id, title: approvals.title, projectId: approvals.projectId, subjectType: approvals.subjectType, subjectId: approvals.subjectId, dueDate: approvals.dueDate, createdAt: approvals.createdAt })
        .from(approvals)
        .where(
          and(
            inArray(approvals.projectId, projectIds),
            eq(approvals.status, "pending"),
            ctx.auth.role === "client" ? or(eq(approvals.requestedFrom, ctx.auth.userId), isNull(approvals.requestedFrom)) : undefined,
          ),
        )
        .orderBy(asc(approvals.dueDate))
        .limit(20);

  const changeOrders = internal || ctx.auth.role === "client" ? await pendingChangeOrders(ctx, projectIds) : [];

  // Budget alerts for active projects (only for users who may see financials).
  const budgetAlerts: { projectId: string; projectName: string; level: string; message: string }[] = [];
  if (await hasPermission(ctx, "budget:read")) {
    for (const p of activeProjects.slice(0, 25)) {
      const { summary } = await computeProjectBudget(ctx.deps, p.id);
      for (const a of summary.alerts) budgetAlerts.push({ projectId: p.id, projectName: p.name, level: a.level, message: a.message });
    }
  }

  const weather = none
    ? []
    : await db
        .select({ alert: weatherAlerts, projectName: projects.name, taskTitle: tasks.title })
        .from(weatherAlerts)
        .innerJoin(projects, eq(projects.id, weatherAlerts.projectId))
        .leftJoin(tasks, eq(tasks.id, weatherAlerts.taskId))
        .where(and(inArray(weatherAlerts.projectId, projectIds), gte(weatherAlerts.forDate, today), isNull(weatherAlerts.acknowledgedAt)))
        .orderBy(asc(weatherAlerts.forDate))
        .limit(20);

  const recentPhotoRows = none
    ? []
    : await db
        .select({ id: photos.id, projectId: photos.projectId, caption: photos.caption, takenAt: photos.takenAt, storageKey: photos.storageKey, thumbnailKey: photos.thumbnailKey, uploadStatus: photos.uploadStatus })
        .from(photos)
        .where(and(inArray(photos.projectId, projectIds), isNull(photos.deletedAt), ctx.auth.role === "client" ? eq(photos.visibility, "client") : undefined))
        .orderBy(desc(photos.takenAt))
        .limit(12);
  const recentPhotos = await Promise.all(
    recentPhotoRows.map(async (p) => ({
      id: p.id,
      projectId: p.projectId,
      caption: p.caption,
      takenAt: p.takenAt,
      thumbnailUrl:
        p.uploadStatus !== "pending" && (p.thumbnailKey || p.storageKey)
          ? await ctx.deps.storage.createDownloadUrl((p.thumbnailKey ?? p.storageKey)!, { expiresInSeconds: ctx.deps.env.SIGNED_URL_TTL_SECONDS })
          : null,
    })),
  );

  const behindSchedule = activeProjects.filter(
    (p) => p.projectedCompletionDate && p.plannedCompletionDate && p.projectedCompletionDate > p.plannedCompletionDate,
  ).length;

  return {
    today,
    counts: {
      activeProjects: activeProjects.length,
      tasksToday: todaysSchedule.length,
      overdueTasks: overdue.length,
      pendingApprovals: outstandingApprovals.length,
      pendingChangeOrders: changeOrders.length,
      behindSchedule,
      weatherAlerts: weather.length,
    },
    activeProjects,
    todaysSchedule,
    upcomingTasks: upcoming,
    overdueTasks: overdue,
    recentActivity,
    outstandingApprovals,
    pendingChangeOrders: changeOrders,
    budgetAlerts,
    weatherAlerts: weather.map((w) => ({ ...w.alert, projectName: w.projectName, taskTitle: w.taskTitle })),
    recentPhotos,
  };
}

export async function projectActivity(ctx: Ctx, projectId: string, opts: { before?: string; limit: number }) {
  await loadProject(ctx, projectId);
  const internal = isInternal(ctx);
  const rows = await ctx.deps.db
    .select()
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.projectId, projectId),
        internal ? undefined : eq(activityLogs.clientVisible, true),
        opts.before ? lt(activityLogs.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(activityLogs.createdAt))
    .limit(opts.limit + 1);
  const items = rows.slice(0, opts.limit).map(({ changeSeq: _s, ipAddress: _ip, ...r }) => r);
  return { items, nextBefore: rows.length > opts.limit ? items.at(-1)!.createdAt : null };
}

export async function acknowledgeWeatherAlert(ctx: Ctx, alertId: string) {
  const [alert] = await ctx.deps.db.select().from(weatherAlerts).where(eq(weatherAlerts.id, alertId));
  if (!alert) return;
  await loadProject(ctx, alert.projectId);
  await ctx.deps.db
    .update(weatherAlerts)
    .set({ acknowledgedAt: new Date().toISOString(), acknowledgedBy: ctx.auth.userId })
    .where(eq(weatherAlerts.id, alertId));
}
