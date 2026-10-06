import { and, asc, eq } from "drizzle-orm";
import { payments } from "@pool/database";
import type { PaymentInput } from "@pool/validation";
import { updatePaymentSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { notFound } from "../lib/errors";
import { formatCents } from "@pool/core";
import { loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";

export async function listPayments(ctx: Ctx, projectId: string) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "payment:read");
  const rows = await ctx.deps.db
    .select()
    .from(payments)
    .where(eq(payments.projectId, projectId))
    .orderBy(asc(payments.dueDate), asc(payments.createdAt));
  const total = rows.filter((p) => p.status !== "void").reduce((s, p) => s + p.amountCents, 0);
  const paid = rows.filter((p) => p.status === "paid").reduce((s, p) => s + p.amountCents, 0);
  return { items: rows, totals: { scheduledCents: total, paidCents: paid, outstandingCents: total - paid } };
}

export async function createPayment(ctx: Ctx, projectId: string, input: PaymentInput) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "payment:manage");
  const [row] = await ctx.deps.db.insert(payments).values({ ...input, projectId, createdBy: ctx.auth.userId }).returning();
  return row!;
}

export async function updatePayment(ctx: Ctx, projectId: string, paymentId: string, input: z.infer<typeof updatePaymentSchema>) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "payment:manage");
  const [current] = await ctx.deps.db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.projectId, projectId)));
  if (!current) throw notFound("Payment");
  const set = { ...input, updatedBy: ctx.auth.userId } as Partial<typeof payments.$inferInsert>;
  if (input.status === "paid" && !current.paidAt && input.paidAt === undefined) set.paidAt = new Date().toISOString();
  const [row] = await ctx.deps.db.update(payments).set(set).where(eq(payments.id, paymentId)).returning();
  if (input.status === "paid" && current.status !== "paid") {
    await recordActivity(ctx, {
      projectId,
      action: "payment.recorded",
      entityType: "payment",
      entityId: paymentId,
      summary: `recorded payment "${current.label}" (${formatCents(current.amountCents)})`,
      clientVisible: true,
    });
  }
  return row!;
}
