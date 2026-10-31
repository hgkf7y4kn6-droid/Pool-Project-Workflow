import { and, desc, eq, isNull } from "drizzle-orm";
import { effectivePermitStatus, permitDateProblem, stampPermitDates, todayISO } from "@pool/core";
import { documents, permits, projectStages, type DbOrTx } from "@pool/database";
import { PERMIT_STATUS_LABELS } from "@pool/types";
import type { PermitInput } from "@pool/validation";
import { updatePermitSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { badRequest, notFound } from "../lib/errors";
import { loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { strip } from "./mappers";
import { organizationTimezone } from "./schedule";

type Row = typeof permits.$inferSelect;

const label = (r: Pick<Row, "permitType" | "permitNumber">) => `${r.permitType.replace(/_/g, " ")} permit${r.permitNumber ? ` ${r.permitNumber}` : ""}`;

function permitOut(row: Row, today: string) {
  return { ...strip(row), effectiveStatus: effectivePermitStatus(row, today) };
}

async function orgToday(ctx: Ctx, db: DbOrTx) {
  return todayISO(await organizationTimezone(db, ctx.auth.organizationId), ctx.deps.now());
}

/** The stage and document a permit points at must belong to the same project. */
async function checkReferences(db: DbOrTx, projectId: string, refs: { stageId?: string | null; documentId?: string | null }) {
  if (refs.stageId) {
    const [stage] = await db
      .select({ id: projectStages.id })
      .from(projectStages)
      .where(and(eq(projectStages.id, refs.stageId), eq(projectStages.projectId, projectId), isNull(projectStages.deletedAt)));
    if (!stage) throw badRequest("Stage not found in this project", { stageId: ["Unknown stage"] });
  }
  if (refs.documentId) {
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, refs.documentId), eq(documents.projectId, projectId), isNull(documents.deletedAt)));
    if (!doc) throw badRequest("Document not found in this project", { documentId: ["Unknown document"] });
  }
}

function assertDates(p: Parameters<typeof permitDateProblem>[0]) {
  const problem = permitDateProblem(p);
  if (problem) throw badRequest(problem);
}

async function loadPermit(ctx: Ctx, permitId: string, db: DbOrTx) {
  const [row] = await db.select().from(permits).where(and(eq(permits.id, permitId), isNull(permits.deletedAt)));
  if (!row) throw notFound("Permit");
  await loadProject(ctx, row.projectId, db);
  return row;
}

export async function listPermits(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "permit:read");
  const db = ctx.deps.db;
  const [rows, today] = await Promise.all([
    db
      .select()
      .from(permits)
      .where(and(eq(permits.projectId, projectId), isNull(permits.deletedAt)))
      .orderBy(desc(permits.createdAt)),
    orgToday(ctx, db),
  ]);
  return rows.map((r) => permitOut(r, today));
}

export async function getPermit(ctx: Ctx, permitId: string) {
  const row = await loadPermit(ctx, permitId, ctx.deps.db);
  await requirePermission(ctx, "permit:read");
  return permitOut(row, await orgToday(ctx, ctx.deps.db));
}

export async function createPermit(ctx: Ctx, projectId: string, input: PermitInput) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "permit:manage");
  return ctx.deps.db.transaction(async (tx) => {
    const today = await orgToday(ctx, tx);
    await checkReferences(tx, projectId, input);
    const { id, ...rest } = input;
    const values = stampPermitDates(
      {
        ...rest,
        stageId: rest.stageId ?? null,
        permitNumber: rest.permitNumber ?? null,
        submittedOn: rest.submittedOn ?? null,
        issuedOn: rest.issuedOn ?? null,
        expiresOn: rest.expiresOn ?? null,
        finaledOn: rest.finaledOn ?? null,
        documentId: rest.documentId ?? null,
        notes: rest.notes ?? null,
      },
      today,
    );
    assertDates(values);
    const [row] = await tx
      .insert(permits)
      .values({ ...(id ? { id } : {}), ...values, projectId, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
      .returning();
    await recordActivity(
      ctx,
      {
        projectId,
        action: "permit.recorded",
        entityType: "permit",
        entityId: row!.id,
        summary: `added the ${label(row!)} (${PERMIT_STATUS_LABELS[row!.status].toLowerCase()})`,
        metadata: { status: row!.status },
      },
      tx,
    );
    return permitOut(row!, today);
  });
}

export async function updatePermit(ctx: Ctx, permitId: string, input: z.infer<typeof updatePermitSchema>) {
  return ctx.deps.db.transaction(async (tx) => {
    const current = await loadPermit(ctx, permitId, tx);
    await requirePermission(ctx, "permit:manage");
    const today = await orgToday(ctx, tx);
    await checkReferences(tx, current.projectId, input);
    const next = stampPermitDates({ ...current, ...input }, today);
    assertDates(next);
    const { id: _id, projectId: _p, createdAt: _c, createdBy: _cb, updatedAt: _u, version: _v, changeSeq: _s, deletedAt: _d, ...values } = next;
    const [row] = await tx
      .update(permits)
      .set({ ...values, updatedBy: ctx.auth.userId })
      .where(eq(permits.id, permitId))
      .returning();
    const statusChanged = row!.status !== current.status;
    await recordActivity(
      ctx,
      {
        projectId: current.projectId,
        action: statusChanged ? "permit.status_changed" : "permit.recorded",
        entityType: "permit",
        entityId: permitId,
        summary: statusChanged
          ? `marked the ${label(row!)} ${PERMIT_STATUS_LABELS[row!.status].toLowerCase()}`
          : `updated the ${label(row!)}`,
        metadata: statusChanged ? { from: current.status, to: row!.status } : {},
      },
      tx,
    );
    return permitOut(row!, today);
  });
}

export async function deletePermit(ctx: Ctx, permitId: string) {
  await ctx.deps.db.transaction(async (tx) => {
    const current = await loadPermit(ctx, permitId, tx);
    await requirePermission(ctx, "permit:manage");
    await tx.update(permits).set({ deletedAt: new Date().toISOString(), updatedBy: ctx.auth.userId }).where(eq(permits.id, permitId));
    await recordActivity(
      ctx,
      { projectId: current.projectId, action: "permit.recorded", entityType: "permit", entityId: permitId, summary: `removed the ${label(current)}` },
      tx,
    );
  });
}
