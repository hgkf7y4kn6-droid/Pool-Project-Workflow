import { and, asc, desc, eq, gt, isNull, lt, inArray } from "drizzle-orm";
import { messages, projectMembers, users, projects, type DbOrTx } from "@pool/database";
import type { MessageInput } from "@pool/validation";
import type { Ctx } from "../context";
import { hasPermission, loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { notify } from "./notifications";
import { strip } from "./mappers";

/**
 * Project messaging. Two kinds of threads share one table:
 * visibility "client" (homeowner ↔ office) and "internal" (staff only).
 * Clients and subcontractors never read internal messages.
 */
export async function listMessages(
  ctx: Ctx,
  projectId: string,
  opts: { threadKey?: string; before?: string; after?: string; limit: number },
) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "message:read");
  const canInternal = await hasPermission(ctx, "message:read_internal");
  const rows = await ctx.deps.db
    .select({ message: messages, authorName: users.fullName, authorRole: users.role })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(
      and(
        eq(messages.projectId, projectId),
        isNull(messages.deletedAt),
        opts.threadKey ? eq(messages.threadKey, opts.threadKey) : undefined,
        canInternal ? undefined : eq(messages.visibility, "client"),
        opts.before ? lt(messages.createdAt, opts.before) : undefined,
        opts.after ? gt(messages.createdAt, opts.after) : undefined,
      ),
    )
    .orderBy(opts.after ? asc(messages.createdAt) : desc(messages.createdAt))
    .limit(opts.limit);
  const items = rows.map((r) => ({ ...strip(r.message), authorName: r.authorName, authorRole: r.authorRole }));
  return opts.after ? items : items.reverse();
}

export async function sendMessage(ctx: Ctx, projectId: string, input: MessageInput, db: DbOrTx = ctx.deps.db) {
  const project = await loadProject(ctx, projectId, db);
  await requirePermission(ctx, "message:send");
  const canInternal = await hasPermission(ctx, "message:read_internal");
  // External users can only post to the client-visible thread.
  const visibility = canInternal ? input.visibility : "client";
  const threadKey = visibility === "client" ? "client" : input.threadKey === "client" ? "general" : input.threadKey;
  const [row] = await db
    .insert(messages)
    .values({
      ...(input.id ? { id: input.id } : {}),
      projectId,
      threadKey,
      authorId: ctx.auth.userId,
      body: input.body,
      visibility,
      attachments: input.attachments,
      createdBy: ctx.auth.userId,
    })
    .returning();

  // Notify the other side of the conversation.
  const members = await db
    .select({ userId: projectMembers.userId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  const internalMembers = members.filter((m) => m.role !== "client" && m.role !== "subcontractor").map((m) => m.userId);
  let recipients: string[];
  if (visibility === "internal") {
    recipients = internalMembers;
  } else if (ctx.auth.role === "client") {
    // Homeowner wrote in: the project manager and office staff on the project.
    recipients = [...internalMembers, ...(project.projectManagerId ? [project.projectManagerId] : [])];
  } else {
    const clientUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.clientId, project.clientId), eq(users.isActive, true)));
    recipients = [...clientUsers.map((u) => u.id), ...(project.projectManagerId ? [project.projectManagerId] : [])];
  }
  const [author] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, ctx.auth.userId));
  await notify(
    ctx.deps,
    {
      organizationId: ctx.auth.organizationId,
      userIds: recipients,
      excludeUserId: ctx.auth.userId,
      type: "message_received",
      projectId,
      title: `New message from ${author?.fullName ?? "your team"}`,
      body: input.body.slice(0, 180),
      data: { messageId: row!.id, threadKey },
    },
    db,
  );
  await recordActivity(ctx, { projectId, action: "message.sent", entityType: "message", entityId: row!.id, summary: `sent a message`, clientVisible: false }, db);
  ctx.deps.events.publish({
    type: "message.created",
    organizationId: ctx.auth.organizationId,
    projectId,
    entityType: "message",
    entityId: row!.id,
    internal: visibility === "internal",
  });
  return { ...strip(row!), authorName: author?.fullName ?? null };
}

/** Latest message per visible project (inbox). */
export async function inbox(ctx: Ctx, projectIds: string[]) {
  if (!projectIds.length) return [];
  const canInternal = await hasPermission(ctx, "message:read_internal");
  const rows = await ctx.deps.db
    .selectDistinctOn([messages.projectId], { message: messages, projectName: projects.name, authorName: users.fullName })
    .from(messages)
    .innerJoin(projects, eq(projects.id, messages.projectId))
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(and(inArray(messages.projectId, projectIds), isNull(messages.deletedAt), canInternal ? undefined : eq(messages.visibility, "client")))
    .orderBy(messages.projectId, desc(messages.createdAt));
  return rows
    .map((r) => ({ ...strip(r.message), projectName: r.projectName, authorName: r.authorName }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
