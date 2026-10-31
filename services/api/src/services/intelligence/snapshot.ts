import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { todayISO, type IntelligenceSnapshot } from "@pool/core";
import {
  activityLogs,
  approvals,
  changeOrders,
  checklistItems,
  clients,
  documents,
  inspections,
  materials,
  materialUsage,
  messages,
  organizations,
  permits,
  photos,
  projects,
  projectStages,
  taskDependencies,
  tasks,
  teams,
  users,
  vendors,
  weatherAlerts,
  type DbOrTx,
} from "@pool/database";
import type { OrganizationSettings } from "@pool/types";
import type { Deps } from "../../context";

/** Activity actions that mean "the schedule changed". */
const SCHEDULE_ACTIONS = ["schedule.shifted"] as const;
const MIN_HISTORY_SAMPLES = 5;

export interface LoadedProject {
  snapshot: IntelligenceSnapshot;
  organization: { id: string; timezone: string; settings: OrganizationSettings };
  project: { id: string; name: string; number: string; projectManagerId: string | null; clientName: string | null };
}

/**
 * Build the rules-engine snapshot for one project. This is an internal
 * (staff-level) view: no costs, margins or prices are included, so every
 * role with `intelligence:read` may see all of it. Callers must already have
 * authorized access to the project (loadProject) or be a system job.
 */
export async function loadSnapshot(deps: Deps, organizationId: string, projectId: string, db: DbOrTx = deps.db): Promise<LoadedProject | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  const [p] = await db
    .select({ project: projects, clientName: sql<string | null>`${clients.firstName} || ' ' || ${clients.lastName}` })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId), isNull(projects.deletedAt)));
  if (!org || !p) return null;
  const project = p.project;
  const today = todayISO(org.timezone, deps.now());

  const [stageRows, taskRows, depRows, checklistRows, inspRows, permitRows, approvalRows, coRows, matRows, docRows, weatherRows, activity, photoLinks] = await Promise.all([
    db.select().from(projectStages).where(and(eq(projectStages.projectId, projectId), isNull(projectStages.deletedAt))).orderBy(asc(projectStages.sortOrder)),
    db.select().from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt))),
    db.select().from(taskDependencies).where(and(eq(taskDependencies.projectId, projectId), isNull(taskDependencies.deletedAt))),
    db.select().from(checklistItems).where(and(eq(checklistItems.projectId, projectId), isNull(checklistItems.deletedAt))),
    db.select().from(inspections).where(and(eq(inspections.projectId, projectId), isNull(inspections.deletedAt))),
    db.select().from(permits).where(and(eq(permits.projectId, projectId), isNull(permits.deletedAt))),
    db.select().from(approvals).where(eq(approvals.projectId, projectId)),
    db.select().from(changeOrders).where(and(eq(changeOrders.projectId, projectId), isNull(changeOrders.deletedAt))),
    db
      .select({ usage: materialUsage, name: materials.name, vendorName: vendors.name })
      .from(materialUsage)
      .innerJoin(materials, eq(materials.id, materialUsage.materialId))
      .leftJoin(vendors, eq(vendors.id, sql`coalesce(${materialUsage.vendorId}, ${materials.preferredVendorId})`))
      .where(eq(materialUsage.projectId, projectId)),
    db.select({ id: documents.id, category: documents.category, title: documents.title }).from(documents).where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt))),
    db.select().from(weatherAlerts).where(and(eq(weatherAlerts.projectId, projectId), gte(weatherAlerts.forDate, today))),
    db
      .select({ id: activityLogs.id, summary: activityLogs.summary, createdAt: activityLogs.createdAt, action: activityLogs.action, clientVisible: activityLogs.clientVisible })
      .from(activityLogs)
      .where(eq(activityLogs.projectId, projectId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(200),
    db
      .select({ checklistItemId: photos.checklistItemId })
      .from(photos)
      .where(and(eq(photos.projectId, projectId), isNotNull(photos.checklistItemId), isNull(photos.deletedAt))),
  ]);

  const [lastClientMessage] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.projectId, projectId), eq(messages.visibility, "client"), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const photoItems = new Set(photoLinks.map((r) => r.checklistItemId));
  const lastClientActivity = activity.find((a) => a.clientVisible)?.createdAt ?? null;
  const lastClientUpdateAt = [lastClientMessage?.createdAt ?? null, lastClientActivity].filter((d): d is string => !!d).sort().at(-1) ?? null;
  const lastScheduleChangeAt = activity.find((a) => (SCHEDULE_ACTIONS as readonly string[]).includes(a.action))?.createdAt ?? null;

  // Display names for people, crews and subcontractors referenced by tasks.
  const userIds = [...new Set(taskRows.flatMap((t) => [t.assigneeId, project.projectManagerId]).filter((x): x is string => !!x))];
  const teamIds = [...new Set(taskRows.map((t) => t.crewTeamId).filter((x): x is string => !!x))];
  const subIds = [...new Set(taskRows.map((t) => t.subcontractorId).filter((x): x is string => !!x))];
  const [userNames, teamNames, subNames] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, userIds)) : [],
    teamIds.length ? db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)) : [],
    subIds.length ? db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, subIds)) : [],
  ]);

  const snapshot: IntelligenceSnapshot = {
    today,
    project: {
      id: project.id,
      name: project.name,
      number: project.number,
      status: project.status,
      projectManagerId: project.projectManagerId,
      plannedStartDate: project.plannedStartDate,
      plannedCompletionDate: project.plannedCompletionDate,
      projectedCompletionDate: project.projectedCompletionDate,
      actualCompletionDate: project.actualCompletionDate,
      lastActivityAt: activity[0]?.createdAt ?? null,
      lastClientUpdateAt,
      lastScheduleChangeAt,
      createdAt: project.createdAt,
    },
    stages: stageRows.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      sortOrder: s.sortOrder,
      status: s.status,
      plannedStartDate: s.plannedStartDate,
      plannedEndDate: s.plannedEndDate,
      actualStartDate: s.actualStartDate,
      actualEndDate: s.actualEndDate,
      clientVisible: s.clientVisible,
    })),
    tasks: taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      stageId: t.stageId,
      status: t.status,
      priority: t.priority,
      assigneeId: t.assigneeId,
      crewTeamId: t.crewTeamId,
      subcontractorId: t.subcontractorId,
      isMilestone: t.isMilestone,
      plannedStartDate: t.plannedStartDate,
      plannedEndDate: t.plannedEndDate,
      actualStartDate: t.actualStartDate,
      actualEndDate: t.actualEndDate,
      durationDays: t.durationDays,
      dueDate: t.dueDate,
      weatherSensitive: t.weatherSensitive,
      sourceInspectionId: t.sourceInspectionId,
    })),
    dependencies: depRows.map((d) => ({ id: d.id, predecessorId: d.predecessorId, successorId: d.successorId, type: d.type, lagDays: d.lagDays })),
    checklist: checklistRows.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      label: c.label,
      required: c.required,
      requiresPhoto: c.requiresPhoto,
      isChecked: c.isChecked,
      hasPhoto: photoItems.has(c.id),
    })),
    inspections: inspRows.map((i) => ({
      id: i.id,
      stageId: i.stageId,
      inspectionType: i.inspectionType,
      result: i.result,
      scheduledFor: i.scheduledFor,
      inspectedAt: i.inspectedAt,
      createdAt: i.createdAt,
    })),
    permits: permitRows.map((pm) => ({
      id: pm.id,
      stageId: pm.stageId,
      permitType: pm.permitType,
      jurisdiction: pm.jurisdiction,
      permitNumber: pm.permitNumber,
      status: pm.status,
      issuedOn: pm.issuedOn,
      expiresOn: pm.expiresOn,
    })),
    approvals: approvalRows.map((a) => ({ id: a.id, subjectType: a.subjectType, title: a.title, status: a.status, dueDate: a.dueDate, createdAt: a.createdAt })),
    changeOrders: coRows.map((c) => ({ id: c.id, number: c.number, title: c.title, status: c.status, scheduleImpactDays: c.scheduleImpactDays, submittedAt: c.submittedAt })),
    materials: matRows.map((m) => ({
      id: m.usage.id,
      name: m.name,
      taskId: m.usage.taskId,
      status: m.usage.status,
      orderedAt: m.usage.orderedAt,
      deliveredAt: m.usage.deliveredAt,
      requiredBy: m.usage.requiredBy,
      expectedDeliveryDate: m.usage.expectedDeliveryDate,
      deliveryConfirmedAt: m.usage.deliveryConfirmedAt,
      leadTimeDays: m.usage.leadTimeDays,
      vendorName: m.vendorName,
    })),
    documents: docRows,
    weatherAlerts: weatherRows.filter((w) => w.severity !== "advisory").map((w) => ({ id: w.id, taskId: w.taskId, date: w.forDate, summary: w.message })),
    names: Object.fromEntries([...userNames, ...teamNames, ...subNames].map((r) => [r.id, r.name])),
    recentActivity: activity.slice(0, 15).map((a) => ({ id: a.id, summary: a.summary, createdAt: a.createdAt })),
    stageHistory: await stageHistory(db, organizationId, stageRows.map((s) => s.key)),
  };
  return {
    snapshot,
    organization: { id: org.id, timezone: org.timezone, settings: org.settings },
    project: { id: project.id, name: project.name, number: project.number, projectManagerId: project.projectManagerId, clientName: p.clientName },
  };
}

/**
 * Median and 80th-percentile calendar durations of completed stages across
 * the organization. Only keys with enough samples are returned, so callers
 * never present a guess as history.
 */
async function stageHistory(db: DbOrTx, organizationId: string, keys: string[]): Promise<IntelligenceSnapshot["stageHistory"]> {
  if (!keys.length) return {};
  const rows = await db
    .select({
      key: projectStages.key,
      n: sql<number>`count(*)::int`,
      median: sql<number>`percentile_cont(0.5) within group (order by (${projectStages.actualEndDate} - ${projectStages.actualStartDate} + 1))`,
      p80: sql<number>`percentile_cont(0.8) within group (order by (${projectStages.actualEndDate} - ${projectStages.actualStartDate} + 1))`,
    })
    .from(projectStages)
    .innerJoin(projects, eq(projects.id, projectStages.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        inArray(projectStages.key, keys),
        eq(projectStages.status, "completed"),
        isNotNull(projectStages.actualStartDate),
        isNotNull(projectStages.actualEndDate),
        isNull(projectStages.deletedAt),
      ),
    )
    .groupBy(projectStages.key);
  return Object.fromEntries(
    rows.filter((r) => r.n >= MIN_HISTORY_SAMPLES).map((r) => [r.key, { sampleSize: r.n, medianDays: Math.round(Number(r.median)), p80Days: Math.round(Number(r.p80)) }]),
  );
}
