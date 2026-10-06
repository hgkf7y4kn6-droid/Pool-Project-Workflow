import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import {
  ACTIVE_PROJECT_STATUSES,
  UPCOMING_PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type Project,
  type ProjectStatus,
} from "@pool/types";
import {
  WorkCalendar,
  computeScheduleSummary,
  planStages,
  redactProjectForClient,
  todayISO,
} from "@pool/core";
import {
  approvals,
  budgets,
  changeOrders,
  checklistItems,
  clients,
  organizations,
  photos,
  projectMembers,
  projectStages,
  projects,
  properties,
  stageTemplates,
  taskDependencies,
  tasks,
  users,
  type DbOrTx,
} from "@pool/database";
import type { CreateProjectInput, ProjectListQuery, UpdateProjectInput } from "@pool/validation";
import { updateStageSchema, addProjectMemberSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { badRequest, conflict, notFound } from "../lib/errors";
import { decodeCursor, page } from "../lib/http";
import { hasPermission, isInternal, loadProject, projectAccessCondition, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { getBudgetSummary } from "./budget";
import { formatAddress } from "./mappers";
import { recalculateProject } from "./schedule";

const calendar = new WorkCalendar();

async function orgSettings(db: DbOrTx, organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw notFound("Organization");
  return org;
}

const projectSelect = {
  project: projects,
  clientName: sql<string>`${clients.firstName} || ' ' || ${clients.lastName}`,
  propertyAddress: properties.address,
  city: properties.city,
  latitude: properties.latitude,
  longitude: properties.longitude,
  projectManagerName: users.fullName,
};

type ProjectJoinRow = {
  project: typeof projects.$inferSelect;
  clientName: string;
  propertyAddress: (typeof properties.$inferSelect)["address"];
  city: string;
  latitude: number | null;
  longitude: number | null;
  projectManagerName: string | null;
};

function shape(row: ProjectJoinRow) {
  const { changeSeq: _seq, deletedAt: _d, ...p } = row.project;
  return {
    ...p,
    clientName: row.clientName,
    propertyAddress: formatAddress(row.propertyAddress),
    city: row.city,
    location: row.latitude !== null && row.longitude !== null ? { latitude: row.latitude, longitude: row.longitude } : null,
    projectManagerName: row.projectManagerName,
  };
}

/** Apply client redaction when the caller is a client. */
async function present(ctx: Ctx, rows: ReturnType<typeof shape>[]) {
  if (ctx.auth.role !== "client") return rows;
  const org = await orgSettings(ctx.deps.db, ctx.auth.organizationId);
  // redactProjectForClient keeps every other field and drops internal ones.
  return rows.map((r) => redactProjectForClient(r as unknown as Project, org.settings) as unknown as typeof r);
}

export async function listProjects(ctx: Ctx, q: ProjectListQuery) {
  const offset = decodeCursor(q.cursor);
  const filters: (SQL | undefined)[] = [projectAccessCondition(ctx), isNull(projects.deletedAt)];
  switch (q.scope) {
    case "active":
      filters.push(inArray(projects.status, [...ACTIVE_PROJECT_STATUSES]), isNull(projects.archivedAt));
      break;
    case "upcoming":
      filters.push(inArray(projects.status, [...UPCOMING_PROJECT_STATUSES]), isNull(projects.archivedAt));
      break;
    case "completed":
      filters.push(inArray(projects.status, ["completed", "warranty"]), isNull(projects.archivedAt));
      break;
    case "archived":
      filters.push(isNotNull(projects.archivedAt));
      break;
    default:
      filters.push(isNull(projects.archivedAt));
  }
  if (q.status) filters.push(eq(projects.status, q.status));
  if (q.type) filters.push(eq(projects.type, q.type));
  if (q.projectManagerId) filters.push(eq(projects.projectManagerId, q.projectManagerId));
  if (q.crewTeamId) filters.push(eq(projects.crewTeamId, q.crewTeamId));
  if (q.clientId) filters.push(eq(projects.clientId, q.clientId));
  if (q.city) filters.push(ilike(properties.city, q.city));
  if (q.startFrom) filters.push(gte(projects.plannedStartDate, q.startFrom));
  if (q.startTo) filters.push(lte(projects.plannedStartDate, q.startTo));
  if (q.completionFrom) filters.push(gte(projects.plannedCompletionDate, q.completionFrom));
  if (q.completionTo) filters.push(lte(projects.plannedCompletionDate, q.completionTo));
  if (q.q) {
    const like = `%${q.q.replace(/[%_]/g, "\\$&")}%`;
    filters.push(
      or(
        ilike(projects.name, like),
        ilike(projects.number, like),
        ilike(clients.lastName, like),
        ilike(clients.firstName, like),
        sql`${properties.address}->>'line1' ilike ${like}`,
      ),
    );
  }
  const orderBy =
    q.sort === "name"
      ? [asc(projects.name)]
      : q.sort === "start"
        ? [asc(projects.plannedStartDate), asc(projects.name)]
        : q.sort === "completion"
          ? [asc(projects.plannedCompletionDate), asc(projects.name)]
          : [desc(projects.updatedAt)];

  const rows = await ctx.deps.db
    .select(projectSelect)
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(properties, eq(properties.id, projects.propertyId))
    .leftJoin(users, eq(users.id, projects.projectManagerId))
    .where(and(...filters))
    .orderBy(...orderBy)
    .limit(q.limit + 1)
    .offset(offset);
  const result = page(rows.map(shape), q.limit, offset);
  return { ...result, items: await present(ctx, result.items) };
}

export async function getProject(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  const [row] = await ctx.deps.db
    .select(projectSelect)
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(properties, eq(properties.id, projects.propertyId))
    .leftJoin(users, eq(users.id, projects.projectManagerId))
    .where(eq(projects.id, projectId));
  const stages = await ctx.deps.db
    .select()
    .from(projectStages)
    .where(
      and(
        eq(projectStages.projectId, projectId),
        isNull(projectStages.deletedAt),
        ctx.auth.role === "client" ? eq(projectStages.clientVisible, true) : undefined,
      ),
    )
    .orderBy(asc(projectStages.sortOrder));
  const members = isInternal(ctx)
    ? await ctx.deps.db
        .select({ userId: projectMembers.userId, role: projectMembers.role, fullName: users.fullName, email: users.email, phone: users.phone })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, projectId))
    : [];
  const [shaped] = await present(ctx, [shape(row!)]);
  return { ...shaped!, stages: stages.map(({ changeSeq: _s, ...st }) => st), members };
}

async function nextProjectNumber(tx: DbOrTx, organizationId: string, year: number): Promise<string> {
  // Serialize numbering per organization for the rest of this transaction.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`);
  const prefix = `P-${year}-`;
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(substring(${projects.number} from ${prefix.length + 1})::int), 0)` })
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), sql`${projects.number} like ${prefix + "%"}`, sql`substring(${projects.number} from ${prefix.length + 1}) ~ '^[0-9]+$'`));
  return `${prefix}${String((row?.n ?? 0) + 1).padStart(3, "0")}`;
}

/**
 * Create a project. The address captured here (inline property) is reused
 * everywhere: maps, weather, documents, reports and client communications.
 * Stages, stage tasks with checklists and FS dependencies are generated from
 * the organization's stage templates.
 */
export async function createProject(ctx: Ctx, input: CreateProjectInput) {
  await requirePermission(ctx, "project:create");
  const orgId = ctx.auth.organizationId;

  const projectId = await ctx.deps.db.transaction(async (tx) => {
    let clientId = input.clientId;
    if (input.client) {
      const { id, ...c } = input.client;
      const [created] = await tx
        .insert(clients)
        .values({ ...(id ? { id } : {}), ...c, organizationId: orgId, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
        .returning();
      clientId = created!.id;
      await recordActivity(ctx, { projectId: null, action: "client.created", entityType: "client", entityId: clientId, summary: `added client ${c.firstName} ${c.lastName}` }, tx);
    } else {
      const [c] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId!), eq(clients.organizationId, orgId)));
      if (!c) throw badRequest("Client not found", { clientId: ["Unknown client"] });
    }

    let propertyId = input.propertyId;
    if (input.property) {
      const { id, location, ...p } = input.property;
      const [created] = await tx
        .insert(properties)
        .values({
          ...(id ? { id } : {}),
          ...p,
          organizationId: orgId,
          clientId: clientId!,
          city: p.address.city,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          locationAccuracyM: location?.accuracyMeters ?? null,
          createdBy: ctx.auth.userId,
          updatedBy: ctx.auth.userId,
        })
        .returning();
      propertyId = created!.id;
    } else {
      const [p] = await tx
        .select({ id: properties.id, clientId: properties.clientId })
        .from(properties)
        .where(and(eq(properties.id, propertyId!), eq(properties.organizationId, orgId)));
      if (!p) throw badRequest("Property not found", { propertyId: ["Unknown property"] });
      if (p.clientId !== clientId) throw badRequest("Property belongs to a different client", { propertyId: ["Client mismatch"] });
    }

    const templates = await tx
      .select()
      .from(stageTemplates)
      .where(and(eq(stageTemplates.organizationId, orgId), eq(stageTemplates.isActive, true)))
      .orderBy(asc(stageTemplates.sortOrder));
    const chosen = input.stageKeys ? templates.filter((t) => input.stageKeys!.includes(t.key)) : templates;
    const start = input.plannedStartDate ?? null;
    const plan = planStages(
      chosen.map((t) => ({ ...t })),
      start ?? todayISO(),
      calendar,
    );

    const number = await nextProjectNumber(tx, orgId, Number((start ?? todayISO()).slice(0, 4)));
    const [project] = await tx
      .insert(projects)
      .values({
        ...(input.id ? { id: input.id } : {}),
        organizationId: orgId,
        number,
        name: input.name,
        type: input.type,
        status: input.status,
        description: input.description ?? null,
        clientId: clientId!,
        propertyId: propertyId!,
        projectManagerId: input.projectManagerId ?? (ctx.auth.role === "project_manager" ? ctx.auth.userId : null),
        crewTeamId: input.crewTeamId ?? null,
        contractAmountCents: input.contractAmountCents,
        estimatedCostCents: input.estimatedCostCents,
        plannedStartDate: start,
        plannedCompletionDate: input.plannedCompletionDate ?? (start ? plan.completionDate : null),
        projectedCompletionDate: start ? plan.completionDate : null,
        createdBy: ctx.auth.userId,
        updatedBy: ctx.auth.userId,
      })
      .returning();
    const pid = project!.id;

    const memberIds = new Map<string, (typeof projectMembers.$inferInsert)["role"]>();
    memberIds.set(ctx.auth.userId, ctx.auth.role);
    if (project!.projectManagerId) memberIds.set(project!.projectManagerId, "project_manager");
    await tx
      .insert(projectMembers)
      .values([...memberIds].map(([userId, role]) => ({ projectId: pid, userId, role, addedBy: ctx.auth.userId })))
      .onConflictDoNothing();

    let previousTaskId: string | null = null;
    for (const [i, st] of plan.stages.entries()) {
      const [stage] = await tx
        .insert(projectStages)
        .values({
          projectId: pid,
          key: st.key,
          name: st.name,
          sortOrder: i,
          isMilestone: st.isMilestone,
          plannedStartDate: start ? st.plannedStartDate : null,
          plannedEndDate: start ? st.plannedEndDate : null,
          createdBy: ctx.auth.userId,
        })
        .returning();
      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: pid,
          stageId: stage!.id,
          title: st.name,
          isMilestone: st.isMilestone,
          durationDays: st.durationDays,
          weatherSensitive: st.weatherSensitive,
          plannedStartDate: start ? st.plannedStartDate : null,
          plannedEndDate: start ? st.plannedEndDate : null,
          dueDate: start ? st.plannedEndDate : null,
          crewTeamId: input.crewTeamId ?? null,
          createdBy: ctx.auth.userId,
          updatedBy: ctx.auth.userId,
        })
        .returning();
      if (st.checklist.length) {
        await tx.insert(checklistItems).values(
          st.checklist.map((c, n) => ({
            taskId: task!.id,
            projectId: pid,
            label: c.label,
            required: c.required,
            requiresPhoto: !!c.requiresPhoto,
            sortOrder: n,
            createdBy: ctx.auth.userId,
          })),
        );
      }
      if (previousTaskId) {
        await tx.insert(taskDependencies).values({ projectId: pid, predecessorId: previousTaskId, successorId: task!.id, type: "FS", createdBy: ctx.auth.userId });
      }
      previousTaskId = task!.id;
    }

    await tx.insert(budgets).values({ projectId: pid, createdBy: ctx.auth.userId });
    await recordActivity(
      ctx,
      { projectId: pid, action: "project.created", entityType: "project", entityId: pid, summary: `created ${input.name}`, clientVisible: true },
      tx,
    );
    return pid;
  });

  ctx.deps.events.publish({ type: "project.created", organizationId: orgId, projectId, entityType: "project", entityId: projectId });
  return getProject(ctx, projectId);
}

export async function updateProject(ctx: Ctx, projectId: string, input: UpdateProjectInput) {
  const current = await loadProject(ctx, projectId);
  await requirePermission(ctx, "project:update");
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
    throw conflict("This project was changed by someone else. Reload and try again.", { currentVersion: current.version });
  }
  const { expectedVersion: _v, ...patch } = input;
  await ctx.deps.db.transaction(async (tx) => {
    const statusChanged = patch.status && patch.status !== current.status;
    const extra: Partial<typeof projects.$inferInsert> = {};
    if (statusChanged && patch.status === "construction" && !current.actualStartDate) extra.actualStartDate = todayISO();
    if (statusChanged && patch.status === "completed") extra.actualCompletionDate = todayISO();
    await tx
      .update(projects)
      .set({ ...patch, ...extra, updatedBy: ctx.auth.userId })
      .where(eq(projects.id, projectId));
    if (patch.projectManagerId) {
      await tx
        .insert(projectMembers)
        .values({ projectId, userId: patch.projectManagerId, role: "project_manager", addedBy: ctx.auth.userId })
        .onConflictDoNothing();
    }
    if (statusChanged) {
      await recordActivity(
        ctx,
        {
          projectId,
          action: "project.status_changed",
          entityType: "project",
          entityId: projectId,
          summary: `moved the project to ${PROJECT_STATUS_LABELS[patch.status as ProjectStatus]}`,
          metadata: { from: current.status, to: patch.status },
          clientVisible: true,
        },
        tx,
      );
    } else {
      await recordActivity(ctx, { projectId, action: "project.updated", entityType: "project", entityId: projectId, summary: "updated project details", metadata: { fields: Object.keys(patch) } }, tx);
    }
    await recalculateProject(ctx.deps, projectId, tx);
  });
  ctx.deps.events.publish({ type: "project.updated", organizationId: ctx.auth.organizationId, projectId, entityType: "project", entityId: projectId });
  return getProject(ctx, projectId);
}

export async function setArchived(ctx: Ctx, projectId: string, archived: boolean) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "project:archive");
  await ctx.deps.db
    .update(projects)
    .set({ archivedAt: archived ? new Date().toISOString() : null, updatedBy: ctx.auth.userId })
    .where(eq(projects.id, projectId));
  return getProject(ctx, projectId);
}

export async function addMember(ctx: Ctx, projectId: string, input: z.infer<typeof addProjectMemberSchema>) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "project:update");
  const [user] = await ctx.deps.db
    .select()
    .from(users)
    .where(and(eq(users.id, input.userId), eq(users.organizationId, ctx.auth.organizationId)));
  if (!user) throw badRequest("Unknown user");
  await ctx.deps.db
    .insert(projectMembers)
    .values({ projectId, userId: user.id, role: input.role ?? user.role, addedBy: ctx.auth.userId })
    .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: input.role ?? user.role } });
  return getProject(ctx, projectId);
}

export async function removeMember(ctx: Ctx, projectId: string, userId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "project:update");
  await ctx.deps.db.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

export async function updateStage(ctx: Ctx, projectId: string, stageId: string, input: z.infer<typeof updateStageSchema>) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "stage:update");
  const [row] = await ctx.deps.db.transaction(async (tx) => {
    const updated = await tx
      .update(projectStages)
      .set({ ...input, updatedBy: ctx.auth.userId })
      .where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId)))
      .returning();
    if (!updated[0]) throw notFound("Stage");
    if (input.status) {
      await recordActivity(
        ctx,
        { projectId, action: "stage.updated", entityType: "stage", entityId: stageId, summary: `marked ${updated[0].name} as ${input.status.replace("_", " ")}`, clientVisible: updated[0].clientVisible },
        tx,
      );
    }
    await recalculateProject(ctx.deps, projectId, tx);
    return updated;
  });
  return row!;
}

/** Everything the project dashboard shows, in one request. */
export async function projectDashboard(ctx: Ctx, projectId: string) {
  const project = await getProject(ctx, projectId);
  const db = ctx.deps.db;
  const org = await orgSettings(db, ctx.auth.organizationId);
  const today = todayISO(org.timezone);
  const internal = isInternal(ctx);

  const taskCounts = internal
    ? await db
        .select({
          total: count(),
          done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
          overdue: sql<number>`count(*) filter (where ${tasks.status} not in ('done','cancelled') and ${tasks.dueDate} < ${today})::int`,
          today: sql<number>`count(*) filter (where ${tasks.status} not in ('done','cancelled') and ${tasks.plannedStartDate} <= ${today} and coalesce(${tasks.plannedEndDate}, ${tasks.plannedStartDate}) >= ${today})::int`,
          blocked: sql<number>`count(*) filter (where ${tasks.status} = 'blocked')::int`,
        })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    : [];
  const [pendingApprovals] = await db
    .select({ n: count() })
    .from(approvals)
    .where(
      and(
        eq(approvals.projectId, projectId),
        eq(approvals.status, "pending"),
        ctx.auth.role === "client" ? eq(approvals.requestedFrom, ctx.auth.userId) : undefined,
      ),
    );
  const [pendingCOs] = await db
    .select({ n: count() })
    .from(changeOrders)
    .where(and(eq(changeOrders.projectId, projectId), inArray(changeOrders.status, ["submitted", "client_review"])));
  const recentPhotos = await db
    .select({ id: photos.id, thumbnailKey: photos.thumbnailKey, storageKey: photos.storageKey, caption: photos.caption, takenAt: photos.takenAt, kind: photos.kind })
    .from(photos)
    .where(
      and(
        eq(photos.projectId, projectId),
        isNull(photos.deletedAt),
        ctx.auth.role === "client" ? eq(photos.visibility, "client") : undefined,
      ),
    )
    .orderBy(desc(photos.takenAt))
    .limit(8);
  const photoUrls = await Promise.all(
    recentPhotos.map(async (p) => ({
      id: p.id,
      caption: p.caption,
      takenAt: p.takenAt,
      kind: p.kind,
      thumbnailUrl:
        p.thumbnailKey || p.storageKey
          ? await ctx.deps.storage.createDownloadUrl((p.thumbnailKey ?? p.storageKey)!, { expiresInSeconds: ctx.deps.env.SIGNED_URL_TTL_SECONDS })
          : null,
    })),
  );

  const financial = (await hasPermission(ctx, "budget:read")) ? await getBudgetSummary(ctx, projectId) : null;

  return {
    project,
    financial: financial?.summary ?? null,
    schedule: computeScheduleSummary({
      plannedStartDate: project.plannedStartDate,
      plannedCompletionDate: project.plannedCompletionDate,
      projectedCompletionDate: project.projectedCompletionDate,
      actualCompletionDate: project.actualCompletionDate,
      today,
    }),
    stages: project.stages,
    tasks: taskCounts[0] ?? null,
    pendingApprovals: pendingApprovals?.n ?? 0,
    pendingChangeOrders: internal || ctx.auth.role === "client" ? (pendingCOs?.n ?? 0) : 0,
    recentPhotos: photoUrls,
  };
}
