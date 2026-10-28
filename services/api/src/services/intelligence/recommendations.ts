import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { addCalendarDays, todayISO } from "@pool/core";
import { intelligenceRecommendationEvents, intelligenceRecommendations, projects, users } from "@pool/database";
import {
  ACTIVE_RECOMMENDATION_STATUSES,
  INTERNAL_ROLES,
  type Recommendation,
  type RecommendationEvent,
  type RecommendationStatus,
} from "@pool/types";
import {
  approvalRequestSchema,
  createTaskSchema,
  type recommendationAssignSchema,
  type recommendationDismissSchema,
  type recommendationListQuery,
  type recommendationNoteSchema,
  type recommendationSnoozeSchema,
  type z,
} from "@pool/validation";
import type { Ctx } from "../../context";
import { decodeCursor, page } from "../../lib/http";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors";
import { accessibleProjectIds, loadProject, requirePermission } from "../access";
import { requestApproval } from "../approvals";
import { notify } from "../notifications";
import { createTask } from "../tasks";
import { recordRecommendationEvent } from "./evaluator";

type RecRow = typeof intelligenceRecommendations.$inferSelect;

const ACTIVE = [...ACTIVE_RECOMMENDATION_STATUSES] as RecommendationStatus[];
const isActive = (s: RecommendationStatus) => ACTIVE.includes(s);

const severityOrder = sql`case ${intelligenceRecommendations.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

export function toRecommendation(r: RecRow, project: { name: string; number: string }, assigneeName: string | null): Recommendation {
  return {
    id: r.id,
    projectId: r.projectId,
    projectName: project.name,
    projectNumber: project.number,
    agent: r.agent,
    ruleKey: r.ruleKey,
    category: r.category,
    severity: r.severity,
    confidence: r.confidence,
    title: r.title,
    observation: r.observation,
    risk: r.risk,
    recommendedAction: r.recommendedAction,
    responsibleRole: r.responsibleRole as Recommendation["responsibleRole"],
    assigneeId: r.assigneeId,
    assigneeName,
    suggestedDueDate: r.suggestedDueDate,
    dueRationale: r.dueRationale,
    subjectType: r.subjectType as Recommendation["subjectType"],
    subjectId: r.subjectId,
    stageId: r.stageId,
    evidence: r.evidence,
    impact: r.impact,
    missingData: r.missingData,
    requiresApproval: r.requiresApproval,
    proposedAction: r.proposedAction ?? null,
    actionResult: r.actionResult ?? null,
    status: r.status,
    snoozedUntil: r.snoozedUntil,
    escalationLevel: r.escalationLevel,
    reevaluateWhen: r.reevaluateWhen,
    expiresAt: r.expiresAt,
    firstDetectedAt: r.firstDetectedAt,
    lastDetectedAt: r.lastDetectedAt,
    resolvedAt: r.resolvedAt,
    resolutionNote: r.resolutionNote,
    dismissReason: r.dismissReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Select recommendations joined with their project and assignee names. */
function selectRecs(ctx: Ctx) {
  return ctx.deps.db
    .select({ rec: intelligenceRecommendations, projectName: projects.name, projectNumber: projects.number, assigneeName: users.fullName })
    .from(intelligenceRecommendations)
    .innerJoin(projects, eq(projects.id, intelligenceRecommendations.projectId))
    .leftJoin(users, eq(users.id, intelligenceRecommendations.assigneeId));
}

type JoinedRow = { rec: RecRow; projectName: string; projectNumber: string; assigneeName: string | null };
const mapRow = (r: JoinedRow) => toRecommendation(r.rec, { name: r.projectName, number: r.projectNumber }, r.assigneeName);

export async function listRecommendations(ctx: Ctx, q: z.infer<typeof recommendationListQuery>) {
  await requirePermission(ctx, "intelligence:read");
  const ids = q.projectId ? [(await loadProject(ctx, q.projectId)).id] : await accessibleProjectIds(ctx);
  if (!ids.length) return { items: [], nextCursor: null };
  const conditions: (SQL | undefined)[] = [
    eq(intelligenceRecommendations.organizationId, ctx.auth.organizationId),
    inArray(intelligenceRecommendations.projectId, ids),
    inArray(intelligenceRecommendations.status, q.status === "active" ? ACTIVE : q.status),
    q.severity?.length ? inArray(intelligenceRecommendations.severity, q.severity) : undefined,
    q.agent?.length ? inArray(intelligenceRecommendations.agent, q.agent) : undefined,
    q.assigneeId ? eq(intelligenceRecommendations.assigneeId, q.assigneeId === "me" ? ctx.auth.userId : q.assigneeId) : undefined,
  ];
  const offset = decodeCursor(q.cursor);
  const rows = await selectRecs(ctx)
    .where(and(...conditions))
    .orderBy(severityOrder, asc(intelligenceRecommendations.suggestedDueDate), desc(intelligenceRecommendations.lastDetectedAt), asc(intelligenceRecommendations.id))
    .limit(q.limit + 1)
    .offset(offset);
  return page(rows.map(mapRow), q.limit, offset);
}

/** Load a recommendation the caller may see (row-level via its project), or 404. */
async function loadRec(ctx: Ctx, id: string): Promise<JoinedRow> {
  const [row] = await selectRecs(ctx).where(and(eq(intelligenceRecommendations.id, id), eq(intelligenceRecommendations.organizationId, ctx.auth.organizationId)));
  if (!row) throw notFound("Recommendation");
  await loadProject(ctx, row.rec.projectId);
  return row;
}

export async function getRecommendation(ctx: Ctx, id: string): Promise<Recommendation & { history: RecommendationEvent[] }> {
  await requirePermission(ctx, "intelligence:read");
  const row = await loadRec(ctx, id);
  const events = await ctx.deps.db
    .select({ e: intelligenceRecommendationEvents, actorName: users.fullName })
    .from(intelligenceRecommendationEvents)
    .leftJoin(users, eq(users.id, intelligenceRecommendationEvents.actorId))
    .where(eq(intelligenceRecommendationEvents.recommendationId, id))
    .orderBy(desc(intelligenceRecommendationEvents.createdAt));
  return {
    ...mapRow(row),
    history: events.map(({ e, actorName }) => ({
      id: e.id,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorId: e.actorId,
      actorName,
      automationPolicy: e.automationPolicy,
      note: e.note,
      createdAt: e.createdAt,
    })),
  };
}

/** Apply a user's status change in one transaction with its history event. */
async function transition(
  ctx: Ctx,
  id: string,
  action: string,
  allowed: (status: RecommendationStatus) => boolean,
  patch: (row: RecRow) => Partial<typeof intelligenceRecommendations.$inferInsert> & { status: RecommendationStatus },
  note?: string | null,
) {
  await requirePermission(ctx, "intelligence:manage");
  const { rec } = await loadRec(ctx, id);
  await ctx.deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(intelligenceRecommendations).where(eq(intelligenceRecommendations.id, rec.id)).for("update");
    if (!allowed(row!.status)) throw conflict(`Can't ${action.replace(/_/g, " ")} a recommendation that is ${row!.status}`);
    const values = patch(row!);
    await tx
      .update(intelligenceRecommendations)
      .set({ ...values, updatedAt: ctx.deps.now().toISOString(), updatedBy: ctx.auth.userId })
      .where(eq(intelligenceRecommendations.id, rec.id));
    await recordRecommendationEvent(tx, { organizationId: ctx.auth.organizationId, recommendationId: rec.id, action, fromStatus: row!.status, toStatus: values.status, actorId: ctx.auth.userId, note: note ?? null });
  });
  ctx.deps.events.publish({ type: "intelligence.updated", organizationId: ctx.auth.organizationId, projectId: rec.projectId, entityType: "recommendation", entityId: rec.id, internal: true });
  return getRecommendation(ctx, id);
}

export function acknowledgeRecommendation(ctx: Ctx, id: string, input: z.infer<typeof recommendationNoteSchema>) {
  return transition(ctx, id, "acknowledged", (s) => s === "open" || s === "escalated", () => ({ status: "acknowledged" }), input.note);
}

export function startRecommendation(ctx: Ctx, id: string, input: z.infer<typeof recommendationNoteSchema>) {
  return transition(ctx, id, "started", (s) => isActive(s) && s !== "in_progress", () => ({ status: "in_progress", snoozedUntil: null }), input.note);
}

export async function assignRecommendation(ctx: Ctx, id: string, input: z.infer<typeof recommendationAssignSchema>) {
  if (input.assigneeId) {
    const [u] = await ctx.deps.db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, input.assigneeId), eq(users.organizationId, ctx.auth.organizationId)));
    if (!u || !u.isActive || !INTERNAL_ROLES.includes(u.role)) throw badRequest("Recommendations can only be assigned to active team members");
  }
  const result = await transition(ctx, id, "assigned", isActive, (row) => ({ status: row.status === "open" ? "acknowledged" : row.status, assigneeId: input.assigneeId }), input.note);
  if (input.assigneeId && input.assigneeId !== ctx.auth.userId) {
    await notify(ctx.deps, {
      organizationId: ctx.auth.organizationId,
      userIds: [input.assigneeId],
      type: "intelligence_alert",
      projectId: result.projectId,
      title: `Assigned to you: ${result.projectName}`,
      body: result.title,
      data: { recommendationId: id, severity: result.severity },
      dedupeKey: `intel:assign:${id}:${input.assigneeId}`,
    });
  }
  return result;
}

export function snoozeRecommendation(ctx: Ctx, id: string, input: z.infer<typeof recommendationSnoozeSchema>) {
  return transition(
    ctx,
    id,
    "snoozed",
    (s) => isActive(s),
    (row) => {
      // Critical items can only be put off for a day.
      const days = row.severity === "critical" ? Math.min(input.days, 1) : input.days;
      return { status: "snoozed", snoozedUntil: new Date(ctx.deps.now().getTime() + days * 86_400_000).toISOString() };
    },
    input.note,
  );
}

export async function dismissRecommendation(ctx: Ctx, id: string, input: z.infer<typeof recommendationDismissSchema>) {
  const { rec } = await loadRec(ctx, id);
  const needsNote = rec.severity === "critical" || rec.severity === "high" || input.reason === "other";
  if (needsNote && !input.note?.trim()) throw badRequest("Add a short note explaining why", { note: ["Required for high-severity items and for 'Other'"] });
  return transition(
    ctx,
    id,
    "dismissed",
    isActive,
    () => ({ status: "dismissed", dismissReason: input.reason, resolutionNote: input.note ?? null, resolvedAt: ctx.deps.now().toISOString(), resolvedBy: ctx.auth.userId }),
    input.note ? `${input.reason}: ${input.note}` : input.reason,
  );
}

export function resolveRecommendation(ctx: Ctx, id: string, input: z.infer<typeof recommendationNoteSchema>) {
  return transition(
    ctx,
    id,
    "resolved",
    isActive,
    () => ({ status: "resolved", resolutionNote: input.note ?? null, resolvedAt: ctx.deps.now().toISOString(), resolvedBy: ctx.auth.userId }),
    input.note,
  );
}

export function reopenRecommendation(ctx: Ctx, id: string, input: z.infer<typeof recommendationNoteSchema>) {
  return transition(
    ctx,
    id,
    "reopened",
    (s) => !isActive(s) || s === "snoozed",
    () => ({ status: "open", snoozedUntil: null, resolvedAt: null, resolvedBy: null, dismissReason: null }),
    input.note,
  );
}

/**
 * Approve a recommendation's proposed action and run it as the approving
 * user, through the normal service (so its own permission and row checks
 * apply). Idempotent: a second approval returns the first result.
 */
export async function approveRecommendation(
  ctx: Ctx,
  id: string,
  createDraft: (ctx: Ctx, projectId: string, input: { audience: string; kind: string; recommendationId: string }) => Promise<{ id: string }>,
) {
  await requirePermission(ctx, "intelligence:approve");
  const { rec } = await loadRec(ctx, id);
  const action = rec.proposedAction;
  if (!action) throw badRequest("This recommendation has no proposed action to approve");
  if (rec.actionResult) return getRecommendation(ctx, id);
  if (!isActive(rec.status)) throw conflict(`Can't approve a recommendation that is ${rec.status}`);
  const today = todayISO("UTC", ctx.deps.now());

  // Drafts can take a while to write; create first, then claim the result atomically.
  if (action.type === "draft_message") {
    const draft = await createDraft(ctx, rec.projectId, { audience: action.audience, kind: action.kind, recommendationId: rec.id });
    const claimed = await ctx.deps.db
      .update(intelligenceRecommendations)
      .set({ actionResult: { entityType: "communication_draft", entityId: draft.id }, status: "in_progress", updatedBy: ctx.auth.userId, updatedAt: ctx.deps.now().toISOString() })
      .where(and(eq(intelligenceRecommendations.id, rec.id), isNull(intelligenceRecommendations.actionResult)))
      .returning({ id: intelligenceRecommendations.id });
    if (claimed.length) {
      await recordRecommendationEvent(ctx.deps.db, { organizationId: ctx.auth.organizationId, recommendationId: rec.id, action: "action_approved", fromStatus: rec.status, toStatus: "in_progress", actorId: ctx.auth.userId, note: "Draft message created for review", metadata: { entityType: "communication_draft", entityId: draft.id } });
    }
    return getRecommendation(ctx, id);
  }

  await ctx.deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(intelligenceRecommendations).where(eq(intelligenceRecommendations.id, rec.id)).for("update");
    if (row!.actionResult) return;
    let result: { entityType: string; entityId: string };
    if (action.type === "create_task") {
      const task = await createTask(
        ctx,
        rec.projectId,
        createTaskSchema.parse({ title: action.title, stageId: action.stageId, dueDate: action.dueDate && action.dueDate >= today ? action.dueDate : null, description: action.description ?? `From recommendation: ${rec.title}`, priority: rec.severity === "critical" ? "urgent" : rec.severity === "high" ? "high" : "normal" }),
        tx,
      );
      result = { entityType: "task", entityId: task.id };
    } else if (action.type === "request_approval") {
      const approval = await requestApproval(ctx, rec.projectId, approvalRequestSchema.parse({ subjectType: action.subjectType, title: action.title, dueDate: action.dueDate && action.dueDate >= today ? action.dueDate : addCalendarDays(today, 7) }));
      result = { entityType: "approval", entityId: approval.id };
    } else {
      throw new AppError("bad_request", "Unsupported action");
    }
    await tx
      .update(intelligenceRecommendations)
      .set({ actionResult: result, status: "in_progress", updatedBy: ctx.auth.userId, updatedAt: ctx.deps.now().toISOString() })
      .where(eq(intelligenceRecommendations.id, rec.id));
    await recordRecommendationEvent(tx, { organizationId: ctx.auth.organizationId, recommendationId: rec.id, action: "action_approved", fromStatus: row!.status, toStatus: "in_progress", actorId: ctx.auth.userId, metadata: result });
  });
  return getRecommendation(ctx, id);
}

/** Active recommendations for one project, most urgent first (already authorized). */
export async function projectRecommendations(ctx: Ctx, projectId: string, limit = 50) {
  const rows = await selectRecs(ctx)
    .where(and(eq(intelligenceRecommendations.projectId, projectId), inArray(intelligenceRecommendations.status, ACTIVE)))
    .orderBy(severityOrder, asc(intelligenceRecommendations.suggestedDueDate), asc(intelligenceRecommendations.id))
    .limit(limit);
  return rows.map(mapRow);
}

