import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  notificationPreferences,
  notifications,
  projectMembers,
  projects,
  pushTokens,
  users,
  type DbOrTx,
} from "@pool/database";
import { NOTIFICATION_TYPES, type NotificationChannel, type NotificationType } from "@pool/types";
import type { Deps, Ctx } from "../context";
import { notificationPreferenceSchema, pushTokenSchema, z } from "@pool/validation";

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  projectId?: string | null;
  data?: Record<string, unknown>;
  /** Suppress duplicates for recurring scans (weather, overdue). */
  dedupeKey?: string;
  /** Do not notify this user (usually the actor). */
  excludeUserId?: string;
}

const DEFAULT_CHANNELS: NotificationChannel[] = ["push", "in_app"];

/**
 * Create in-app notifications, honoring each user's preferences, then hand
 * push delivery to the job queue so a slow push service never slows a request.
 */
export async function notify(deps: Deps, input: NotifyInput, db: DbOrTx = deps.db): Promise<string[]> {
  const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.excludeUserId);
  if (recipients.length === 0) return [];
  const prefs = await db
    .select()
    .from(notificationPreferences)
    .where(and(inArray(notificationPreferences.userId, recipients), eq(notificationPreferences.type, input.type)));
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
  const active = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, recipients), eq(users.isActive, true), eq(users.organizationId, input.organizationId)));

  const created: string[] = [];
  for (const { id: userId } of active) {
    const pref = prefByUser.get(userId);
    if (pref && !pref.enabled) continue;
    const channels = pref?.channels ?? DEFAULT_CHANNELS;
    const [row] = await db
      .insert(notifications)
      .values({
        organizationId: input.organizationId,
        userId,
        projectId: input.projectId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        data: { ...(input.data ?? {}), projectId: input.projectId ?? null },
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!row) continue; // deduplicated
    created.push(row.id);
    deps.events.publish({
      type: "notification.created",
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      entityType: "notification",
      entityId: row.id,
      userIds: [userId],
      payload: { title: input.title, body: input.body, notificationType: input.type },
    });
    if (channels.includes("push")) {
      await deps.jobs.enqueue("notification.push", { notificationId: row.id });
    }
  }
  return created;
}

/** Deliver one notification to the user's registered devices (job handler). */
export async function deliverPush(deps: Deps, notificationId: string): Promise<void> {
  const [n] = await deps.db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
  if (!n || n.pushedAt) return;
  const tokens = await deps.db
    .select()
    .from(pushTokens)
    .where(and(eq(pushTokens.userId, n.userId), isNull(pushTokens.disabledAt)));
  if (tokens.length) {
    const { invalidTokens } = await deps.push.send(
      tokens.map((t) => ({ to: t.token, title: n.title, body: n.body, data: { ...n.data, notificationId: n.id, type: n.type } })),
    );
    if (invalidTokens.length) {
      await deps.db.update(pushTokens).set({ disabledAt: new Date().toISOString() }).where(inArray(pushTokens.token, invalidTokens));
    }
  }
  await deps.db.update(notifications).set({ pushedAt: new Date().toISOString() }).where(eq(notifications.id, n.id));
}

/** Users who should hear about project-level events (PM + internal members). */
export async function projectStakeholders(
  db: DbOrTx,
  projectId: string,
  roles: string[] = ["admin", "project_manager", "field_supervisor"],
): Promise<string[]> {
  const [p] = await db.select({ pm: projects.projectManagerId }).from(projects).where(eq(projects.id, projectId));
  const members = await db
    .select({ userId: projectMembers.userId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  const ids = members.filter((m) => roles.includes(m.role)).map((m) => m.userId);
  if (p?.pm) ids.push(p.pm);
  return [...new Set(ids)];
}

// --- Endpoints ---------------------------------------------------------------

export async function listNotifications(ctx: Ctx, opts: { unreadOnly?: boolean; before?: string; limit: number }) {
  const rows = await ctx.deps.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, ctx.auth.userId),
        opts.unreadOnly ? isNull(notifications.readAt) : undefined,
        opts.before ? lt(notifications.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit + 1);
  const [{ unread } = { unread: 0 }] = await ctx.deps.db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.auth.userId), isNull(notifications.readAt)));
  const items = rows.slice(0, opts.limit);
  return { items, unread, nextBefore: rows.length > opts.limit ? items.at(-1)!.createdAt : null };
}

export async function markRead(ctx: Ctx, ids: string[] | "all") {
  const now = new Date().toISOString();
  await ctx.deps.db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.userId, ctx.auth.userId),
        isNull(notifications.readAt),
        ids === "all" ? undefined : inArray(notifications.id, ids),
      ),
    );
}

export async function getPreferences(ctx: Ctx) {
  const rows = await ctx.deps.db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, ctx.auth.userId));
  const byType = new Map(rows.map((r) => [r.type, r]));
  return NOTIFICATION_TYPES.map((type) => ({
    type,
    enabled: byType.get(type)?.enabled ?? true,
    channels: byType.get(type)?.channels ?? DEFAULT_CHANNELS,
  }));
}

export async function setPreferences(ctx: Ctx, input: z.infer<typeof notificationPreferenceSchema>) {
  for (const p of input.preferences) {
    await ctx.deps.db
      .insert(notificationPreferences)
      .values({ userId: ctx.auth.userId, type: p.type, channels: p.channels, enabled: p.enabled })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.type],
        set: { channels: p.channels, enabled: p.enabled, updatedAt: new Date().toISOString() },
      });
  }
  return getPreferences(ctx);
}

export async function registerPushToken(ctx: Ctx, input: z.infer<typeof pushTokenSchema>) {
  await ctx.deps.db
    .insert(pushTokens)
    .values({ userId: ctx.auth.userId, token: input.token, platform: input.platform, deviceId: input.deviceId })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId: ctx.auth.userId, deviceId: input.deviceId, lastSeenAt: new Date().toISOString(), disabledAt: null },
    });
}

export async function unregisterPushToken(ctx: Ctx, token: string) {
  await ctx.deps.db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, ctx.auth.userId)));
}
