import { and, desc, eq, inArray } from "drizzle-orm";
import { approvals, designProjects, users } from "@pool/database";
import type { ApprovalDecisionInput, ApprovalRequestInput } from "@pool/validation";
import type { Ctx } from "../context";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors";
import { accessibleProjectIds, hasPermission, loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { transitionChangeOrder } from "./change-orders";
import { notify, projectStakeholders } from "./notifications";

export async function listApprovals(ctx: Ctx, opts: { projectId?: string; status?: "pending" | "approved" | "rejected" | "cancelled" }) {
  await requirePermission(ctx, "approval:read");
  const projectIds = opts.projectId ? [(await loadProject(ctx, opts.projectId)).id] : await accessibleProjectIds(ctx);
  if (!projectIds.length) return [];
  const rows = await ctx.deps.db
    .select({ approval: approvals, requestedFromName: users.fullName })
    .from(approvals)
    .leftJoin(users, eq(users.id, approvals.requestedFrom))
    .where(
      and(
        inArray(approvals.projectId, projectIds),
        opts.status ? eq(approvals.status, opts.status) : undefined,
        // Clients only see approvals addressed to them (or to "any client").
        ctx.auth.role === "client" ? inArray(approvals.subjectType, ["change_order", "design", "document", "milestone", "walkthrough", "other"]) : undefined,
      ),
    )
    .orderBy(desc(approvals.createdAt))
    .limit(200);
  return rows
    .filter((r) => ctx.auth.role !== "client" || !r.approval.requestedFrom || r.approval.requestedFrom === ctx.auth.userId)
    .map((r) => ({ ...r.approval, requestedFromName: r.requestedFromName }));
}

export async function requestApproval(ctx: Ctx, projectId: string, input: ApprovalRequestInput) {
  const project = await loadProject(ctx, projectId);
  await requirePermission(ctx, "approval:request");
  const [row] = await ctx.deps.db
    .insert(approvals)
    .values({ ...input, projectId, createdBy: ctx.auth.userId })
    .returning();
  let recipients: string[] = [];
  if (input.requestedFrom) recipients = [input.requestedFrom];
  else {
    const clientUsers = await ctx.deps.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.clientId, project.clientId), eq(users.isActive, true)));
    recipients = clientUsers.map((u) => u.id);
  }
  await notify(ctx.deps, {
    organizationId: ctx.auth.organizationId,
    userIds: recipients,
    type: "approval_requested",
    projectId,
    title: "Approval requested",
    body: input.title,
    data: { approvalId: row!.id },
  });
  await recordActivity(ctx, { projectId, action: "approval.requested", entityType: "approval", entityId: row!.id, summary: `requested approval: ${input.title}`, clientVisible: true });
  return row!;
}

export async function decideApproval(ctx: Ctx, approvalId: string, input: ApprovalDecisionInput) {
  await requirePermission(ctx, "approval:decide").catch(async (e) => {
    // Office staff may record a decision on the client's behalf (paper signature).
    if (!(await hasPermission(ctx, "change_order:decide_internal"))) throw e;
  });
  const [row] = await ctx.deps.db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!row) throw notFound("Approval");
  await loadProject(ctx, row.projectId);
  if (ctx.auth.role === "client" && row.requestedFrom && row.requestedFrom !== ctx.auth.userId) throw notFound("Approval");
  if (row.status !== "pending") throw badRequest("This approval has already been decided");
  if (input.decision === "approved" && (!input.signatureName || !input.signatureDataUrl)) {
    throw new AppError("validation_failed", "A signature is required to approve", { signatureDataUrl: ["Signature required"] });
  }

  // Change-order approvals go through the change-order workflow (which closes this approval).
  if (row.subjectType === "change_order" && row.subjectId) {
    await transitionChangeOrder(ctx, row.subjectId, {
      to: input.decision,
      notes: input.notes,
      signatureName: input.signatureName,
      signatureDataUrl: input.signatureDataUrl,
    });
    const [after] = await ctx.deps.db.select().from(approvals).where(eq(approvals.id, approvalId));
    return after!;
  }

  const [updated] = await ctx.deps.db
    .update(approvals)
    .set({
      status: input.decision,
      decidedAt: new Date().toISOString(),
      decidedBy: ctx.auth.userId,
      decisionNotes: input.notes ?? null,
      signatureName: input.signatureName ?? null,
      signatureDataUrl: input.signatureDataUrl ?? null,
    })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning();
  if (!updated) throw badRequest("This approval has already been decided");
  if (row.subjectType === "design" && row.subjectId && input.decision === "approved") {
    await ctx.deps.db.update(designProjects).set({ status: "approved" }).where(eq(designProjects.id, row.subjectId));
  }
  await recordActivity(ctx, {
    projectId: row.projectId,
    action: "approval.decided",
    entityType: "approval",
    entityId: approvalId,
    summary: `${input.decision} "${row.title}"`,
    clientVisible: true,
  });
  await notify(ctx.deps, {
    organizationId: ctx.auth.organizationId,
    userIds: [...(await projectStakeholders(ctx.deps.db, row.projectId, ["admin", "project_manager", "designer"])), ...(row.createdBy ? [row.createdBy] : [])],
    excludeUserId: ctx.auth.userId,
    type: "approval_requested",
    projectId: row.projectId,
    title: `Approval ${input.decision}`,
    body: row.title,
    data: { approvalId },
  });
  return updated;
}

export async function cancelApproval(ctx: Ctx, approvalId: string) {
  await requirePermission(ctx, "approval:request");
  const [row] = await ctx.deps.db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!row) throw notFound("Approval");
  await loadProject(ctx, row.projectId);
  if (row.subjectType === "change_order") throw forbidden("Withdraw the change order instead");
  await ctx.deps.db.update(approvals).set({ status: "cancelled" }).where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")));
}

