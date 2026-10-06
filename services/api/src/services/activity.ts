import { activityLogs, users, type DbOrTx } from "@pool/database";
import type { ActivityAction } from "@pool/types";
import { eq } from "drizzle-orm";
import type { Ctx } from "../context";

const nameCache = new Map<string, string>();

async function actorName(db: DbOrTx, userId: string): Promise<string | null> {
  const cached = nameCache.get(userId);
  if (cached) return cached;
  const [u] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
  if (u) nameCache.set(userId, u.fullName);
  return u?.fullName ?? null;
}

export interface ActivityInput {
  projectId: string | null;
  action: ActivityAction;
  entityType: string;
  entityId: string | null;
  /** Human-readable line; the actor's name is prefixed automatically. */
  summary: string;
  metadata?: Record<string, unknown>;
  clientVisible?: boolean;
}

/**
 * Append to the audit trail / activity feed. Call inside the same transaction
 * as the change so the feed never claims something that was rolled back.
 */
export async function recordActivity(ctx: Ctx, input: ActivityInput, db: DbOrTx = ctx.deps.db): Promise<void> {
  const name = await actorName(db, ctx.auth.userId);
  await db.insert(activityLogs).values({
    organizationId: ctx.auth.organizationId,
    projectId: input.projectId,
    actorId: ctx.auth.userId,
    actorName: name,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: name ? `${name} ${input.summary}` : input.summary,
    metadata: input.metadata ?? {},
    clientVisible: input.clientVisible ?? false,
    ipAddress: ctx.ip ?? null,
  });
}

export async function userDisplayName(ctx: Ctx, userId: string): Promise<string | null> {
  return actorName(ctx.deps.db, userId);
}
