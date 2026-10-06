import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  availableChangeOrderTransitions,
  changeOrderVisibleToClient,
  checkChangeOrderTransition,
  redactChangeOrderForClient,
  todayISO,
} from "@pool/core";
import { approvals, changeOrders, payments, photos, tasks, users, type DbOrTx } from "@pool/database";
import { CHANGE_ORDER_STATUS_LABELS, type ChangeOrder } from "@pool/types";
import type { ChangeOrderInput, ChangeOrderTransitionInput } from "@pool/validation";
import type { Ctx } from "../context";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors";
import { loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { checkBudgetAlerts } from "./budget";
import { notify, projectStakeholders } from "./notifications";
import { strip } from "./mappers";
import { createTask } from "./tasks";

type Row = typeof changeOrders.$inferSelect;

function present(ctx: Ctx, row: Row) {
  const base = strip(row) as unknown as ChangeOrder;
  const view = ctx.auth.role === "client" ? redactChangeOrderForClient(base) : base;
  return { ...view, availableTransitions: availableChangeOrderTransitions(row.status, ctx.auth.role) };
}

async function loadChangeOrder(ctx: Ctx, id: string, db: DbOrTx = ctx.deps.db): Promise<Row> {
  const [row] = await db.select().from(changeOrders).where(and(eq(changeOrders.id, id), isNull(changeOrders.deletedAt)));
  if (!row) throw notFound("Change order");
  await loadProject(ctx, row.projectId, db);
  if (ctx.auth.role === "client" && !changeOrderVisibleToClient(row)) throw notFound("Change order");
  if (ctx.auth.role === "subcontractor") throw notFound("Change order");
  return row;
}

export async function listChangeOrders(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "change_order:read");
  const rows = await ctx.deps.db
    .select()
    .from(changeOrders)
    .where(
      and(
        eq(changeOrders.projectId, projectId),
        isNull(changeOrders.deletedAt),
        ctx.auth.role === "client" ? sql`${changeOrders.status} not in ('draft','submitted')` : undefined,
      ),
    )
    .orderBy(desc(changeOrders.number));
  return rows.map((r) => present(ctx, r));
}

export async function getChangeOrder(ctx: Ctx, id: string) {
  const row = await loadChangeOrder(ctx, id);
  const attached = await ctx.deps.db
    .select({ id: photos.id, caption: photos.caption, storageKey: photos.storageKey, thumbnailKey: photos.thumbnailKey })
    .from(photos)
    .where(
      and(
        eq(photos.changeOrderId, id),
        isNull(photos.deletedAt),
        ctx.auth.role === "client" ? eq(photos.visibility, "client") : undefined,
      ),
    );
  const photoList = await Promise.all(
    attached.map(async (p) => ({
      id: p.id,
      caption: p.caption,
      thumbnailUrl:
        p.thumbnailKey || p.storageKey
          ? await ctx.deps.storage.createDownloadUrl((p.thumbnailKey ?? p.storageKey)!, { expiresInSeconds: ctx.deps.env.SIGNED_URL_TTL_SECONDS })
          : null,
    })),
  );
  const [decider] = row.decidedBy ? await ctx.deps.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, row.decidedBy)) : [];
  return { ...present(ctx, row), photos: photoList, decidedByName: decider?.fullName ?? null };
}

export async function createChangeOrder(ctx: Ctx, projectId: string, input: ChangeOrderInput) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "change_order:create");
  const row = await ctx.deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"co:" + projectId}))`);
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${changeOrders.number}), 0)::int + 1` })
      .from(changeOrders)
      .where(eq(changeOrders.projectId, projectId));
    const [created] = await tx
      .insert(changeOrders)
      .values({ ...input, projectId, number: next, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
      .returning();
    await recordActivity(
      ctx,
      { projectId, action: "change_order.created", entityType: "change_order", entityId: created!.id, summary: `drafted Change Order #${next}: ${input.title}` },
      tx,
    );
    return created!;
  });
  return present(ctx, row);
}

export async function updateChangeOrder(ctx: Ctx, id: string, input: Partial<ChangeOrderInput>) {
  const row = await loadChangeOrder(ctx, id);
  await requirePermission(ctx, "change_order:create");
  if (row.status !== "draft") throw badRequest("Only draft change orders can be edited. Return it to draft first.");
  const [updated] = await ctx.deps.db
    .update(changeOrders)
    .set({ ...input, updatedBy: ctx.auth.userId })
    .where(eq(changeOrders.id, id))
    .returning();
  return present(ctx, updated!);
}

/**
 * Move a change order through its workflow. Side effects:
 * - client_review → an approval request + notification for the client
 * - approved/rejected → approval closed, PM notified, budget alerts checked
 * - scheduled → a task is created for the work (with its schedule impact)
 */
export async function transitionChangeOrder(ctx: Ctx, id: string, input: ChangeOrderTransitionInput) {
  const row = await loadChangeOrder(ctx, id);
  const check = checkChangeOrderTransition(row.status, input.to, ctx.auth.role);
  if (!check.allowed) {
    if (check.reason === "forbidden") throw forbidden();
    throw badRequest(`Cannot move a ${CHANGE_ORDER_STATUS_LABELS[row.status]} change order to ${CHANGE_ORDER_STATUS_LABELS[input.to]}`);
  }
  if (check.requiresSignature && (!input.signatureName || !input.signatureDataUrl)) {
    throw new AppError("validation_failed", "A signature is required to approve", { signatureDataUrl: ["Signature required"] });
  }
  const now = new Date().toISOString();
  const updated = await ctx.deps.db.transaction(async (tx) => {
    const set: Partial<typeof changeOrders.$inferInsert> = { status: input.to, updatedBy: ctx.auth.userId };
    if (input.to === "submitted") set.submittedAt = now;
    if (input.to === "approved" || input.to === "rejected") {
      set.decidedAt = now;
      set.decidedBy = ctx.auth.userId;
      set.decisionNotes = input.notes ?? null;
      set.signatureName = input.signatureName ?? null;
      set.signatureDataUrl = input.signatureDataUrl ?? null;
    }
    if (input.to === "draft") {
      set.decidedAt = null;
      set.decidedBy = null;
      set.signatureName = null;
      set.signatureDataUrl = null;
    }
    const [co] = await tx.update(changeOrders).set(set).where(eq(changeOrders.id, id)).returning();
    const project = await loadProject(ctx, row.projectId, tx);
    const label = `Change Order #${row.number}`;

    if (input.to === "client_review") {
      const clientUsers = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.clientId, project.clientId), eq(users.isActive, true), eq(users.role, "client")));
      await tx.insert(approvals).values({
        projectId: row.projectId,
        subjectType: "change_order",
        subjectId: id,
        title: `${label}: ${row.title}`,
        description: row.description,
        requestedFrom: clientUsers[0]?.id ?? null,
        createdBy: ctx.auth.userId,
      });
      await notify(
        ctx.deps,
        {
          organizationId: ctx.auth.organizationId,
          userIds: clientUsers.map((u) => u.id),
          type: "approval_requested",
          projectId: row.projectId,
          title: `Please review ${label}`,
          body: row.title,
          data: { changeOrderId: id },
        },
        tx,
      );
    }
    if (input.to === "approved" || input.to === "rejected") {
      await tx
        .update(approvals)
        .set({
          status: input.to,
          decidedAt: now,
          decidedBy: ctx.auth.userId,
          decisionNotes: input.notes ?? null,
          signatureName: input.signatureName ?? null,
          signatureDataUrl: input.signatureDataUrl ?? null,
        })
        .where(and(eq(approvals.subjectType, "change_order"), eq(approvals.subjectId, id), eq(approvals.status, "pending")));
      await notify(
        ctx.deps,
        {
          organizationId: ctx.auth.organizationId,
          userIds: await projectStakeholders(tx, row.projectId, ["admin", "project_manager"]),
          excludeUserId: ctx.auth.userId,
          type: input.to === "approved" ? "change_order_approved" : "change_order_rejected",
          projectId: row.projectId,
          title: `${label} ${input.to}`,
          body: `${row.title}${input.notes ? ` — "${input.notes}"` : ""}`,
          data: { changeOrderId: id },
        },
        tx,
      );
      if (input.to === "approved" && row.priceCents > 0) {
        await tx.insert(payments).values({
          projectId: row.projectId,
          label: `${label}: ${row.title}`,
          amountCents: row.priceCents,
          status: "scheduled",
          changeOrderId: id,
          createdBy: ctx.auth.userId,
        });
      }
    }
    if (input.to === "scheduled") {
      const coTask = await createTask(
        ctx,
        row.projectId,
        {
          title: `${label}: ${row.title}`,
          description: row.description,
          status: "todo",
          priority: "normal",
          isMilestone: false,
          durationDays: Math.max(row.scheduleImpactDays, 1),
          weatherSensitive: false,
          estimatedHours: row.laborHoursImpact || null,
          checklist: [],
          plannedStartDate: todayISO(),
        },
        tx,
      );
      await tx.update(tasks).set({ sourceChangeOrderId: id }).where(eq(tasks.id, coTask.id));
    }
    await recordActivity(
      ctx,
      {
        projectId: row.projectId,
        action: "change_order.status_changed",
        entityType: "change_order",
        entityId: id,
        summary: `${input.to === "approved" ? "approved" : input.to === "rejected" ? "rejected" : `moved ${label} to ${CHANGE_ORDER_STATUS_LABELS[input.to]}`}${input.to === "approved" || input.to === "rejected" ? ` ${label}` : ""}`,
        metadata: { from: row.status, to: input.to },
        clientVisible: !["draft", "submitted"].includes(input.to),
      },
      tx,
    );
    if (input.to === "approved") await checkBudgetAlerts(ctx.deps, ctx.auth.organizationId, row.projectId, tx);
    return co!;
  });
  ctx.deps.events.publish({
    type: "change_order.updated",
    organizationId: ctx.auth.organizationId,
    projectId: row.projectId,
    entityType: "change_order",
    entityId: id,
  });
  return present(ctx, updated);
}

/** Pending change orders across visible projects (dashboard). */
export async function pendingChangeOrders(ctx: Ctx, projectIds: string[]) {
  if (!projectIds.length) return [];
  const rows = await ctx.deps.db
    .select()
    .from(changeOrders)
    .where(and(inArray(changeOrders.projectId, projectIds), inArray(changeOrders.status, ["submitted", "client_review"]), isNull(changeOrders.deletedAt)))
    .orderBy(asc(changeOrders.submittedAt))
    .limit(50);
  return rows.map((r) => present(ctx, r));
}
