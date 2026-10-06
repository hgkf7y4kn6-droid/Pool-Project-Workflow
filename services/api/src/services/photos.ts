import { and, desc, eq, isNull, lt, type SQL } from "drizzle-orm";
import { checklistItems, photos, tasks, type DbOrTx } from "@pool/database";
import type { PhotoCreateInput } from "@pool/validation";
import { photoUpdateSchema, z } from "@pool/validation";
import type { PhotoKind } from "@pool/types";
import type { Ctx, Deps } from "../context";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { extensionFor, storageKeys } from "../adapters/storage/types";
import { loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { photoOut } from "./mappers";

type PhotoRow = typeof photos.$inferSelect;

async function withUrls(deps: Deps, rows: PhotoRow[]) {
  const ttl = deps.env.SIGNED_URL_TTL_SECONDS;
  return Promise.all(
    rows.map(async (p) =>
      photoOut(p, {
        url: p.storageKey && p.uploadStatus !== "pending" ? await deps.storage.createDownloadUrl(p.storageKey, { expiresInSeconds: ttl }) : null,
        thumbnailUrl: p.thumbnailKey
          ? await deps.storage.createDownloadUrl(p.thumbnailKey, { expiresInSeconds: ttl })
          : p.storageKey && p.uploadStatus !== "pending"
            ? await deps.storage.createDownloadUrl(p.storageKey, { expiresInSeconds: ttl })
            : null,
      }),
    ),
  );
}

async function loadPhoto(ctx: Ctx, photoId: string, db: DbOrTx = ctx.deps.db): Promise<PhotoRow> {
  const [row] = await db.select().from(photos).where(and(eq(photos.id, photoId), isNull(photos.deletedAt)));
  if (!row) throw notFound("Photo");
  await loadProject(ctx, row.projectId, db);
  if (ctx.auth.role === "client" && row.visibility !== "client") throw notFound("Photo");
  return row;
}

export async function listPhotos(
  ctx: Ctx,
  projectId: string,
  q: { taskId?: string; kind?: PhotoKind; inspectionId?: string; changeOrderId?: string; before?: string; limit: number },
) {
  await loadProject(ctx, projectId);
  await requirePermission(ctx, "photo:read");
  const filters: (SQL | undefined)[] = [eq(photos.projectId, projectId), isNull(photos.deletedAt)];
  if (ctx.auth.role === "client") filters.push(eq(photos.visibility, "client"));
  if (ctx.auth.role === "subcontractor") filters.push(eq(photos.createdBy, ctx.auth.userId));
  if (q.taskId) filters.push(eq(photos.taskId, q.taskId));
  if (q.kind) filters.push(eq(photos.kind, q.kind));
  if (q.inspectionId) filters.push(eq(photos.inspectionId, q.inspectionId));
  if (q.changeOrderId) filters.push(eq(photos.changeOrderId, q.changeOrderId));
  if (q.before) filters.push(lt(photos.takenAt, q.before));
  const rows = await ctx.deps.db
    .select()
    .from(photos)
    .where(and(...filters))
    .orderBy(desc(photos.takenAt))
    .limit(q.limit + 1);
  const items = await withUrls(ctx.deps, rows.slice(0, q.limit));
  return { items, nextBefore: rows.length > q.limit ? rows[q.limit - 1]!.takenAt : null };
}

/**
 * Register photo metadata (from the camera flow or offline sync) and return a
 * signed URL for uploading the original. The task's project/stage are
 * inherited automatically so the field worker never has to pick them.
 */
export async function createPhoto(ctx: Ctx, projectId: string, input: PhotoCreateInput, db: DbOrTx = ctx.deps.db) {
  await loadProject(ctx, projectId, db);
  await requirePermission(ctx, "photo:create");
  let stageId = input.stageId ?? null;
  if (input.taskId) {
    const [task] = await db.select({ projectId: tasks.projectId, stageId: tasks.stageId }).from(tasks).where(eq(tasks.id, input.taskId));
    if (!task || task.projectId !== projectId) throw badRequest("Task does not belong to this project");
    stageId = stageId ?? task.stageId;
  }
  if (input.checklistItemId) {
    const [item] = await db.select({ projectId: checklistItems.projectId }).from(checklistItems).where(eq(checklistItems.id, input.checklistItemId));
    if (!item || item.projectId !== projectId) throw badRequest("Checklist item does not belong to this project");
  }
  if (input.visibility === "client" && ctx.auth.role === "subcontractor") throw forbidden("Subcontractors cannot publish client photos");
  const { location, id, ...rest } = input;
  const photoId = id ?? crypto.randomUUID();
  const storageKey = storageKeys.photoOriginal(ctx.auth.organizationId, projectId, photoId, extensionFor(input.mimeType));

  const [existing] = await db.select().from(photos).where(eq(photos.id, photoId));
  if (existing) {
    // Idempotent re-registration from a retried offline upload.
    if (existing.projectId !== projectId) throw badRequest("Photo id already used");
    return { photo: (await withUrls(ctx.deps, [existing]))[0]!, upload: existing.uploadStatus === "pending" ? await uploadTicket(ctx.deps, existing) : null };
  }
  const [row] = await db
    .insert(photos)
    .values({
      ...rest,
      id: photoId,
      stageId,
      organizationId: ctx.auth.organizationId,
      projectId,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      locationAccuracyM: location?.accuracyMeters ?? null,
      storageKey,
      uploadStatus: "pending",
      createdBy: ctx.auth.userId,
      updatedBy: ctx.auth.userId,
    })
    .returning();
  return { photo: photoOut(row!), upload: await uploadTicket(ctx.deps, row!) };
}

async function uploadTicket(deps: Deps, row: PhotoRow) {
  return deps.storage.createUploadUrl(row.storageKey!, { contentType: row.mimeType, expiresInSeconds: 3600 });
}

/** A fresh upload URL (e.g. the previous one expired while offline). */
export async function photoUploadUrl(ctx: Ctx, photoId: string) {
  const row = await loadPhoto(ctx, photoId);
  if (row.createdBy !== ctx.auth.userId) await requirePermission(ctx, "photo:delete");
  return uploadTicket(ctx.deps, row);
}

/** Called after the device finished the PUT; verifies the object and queues thumbnailing. */
export async function completePhotoUpload(ctx: Ctx, photoId: string) {
  const row = await loadPhoto(ctx, photoId);
  const head = await ctx.deps.storage.head(row.storageKey!);
  if (!head) throw badRequest("Upload not found in storage. Upload the file, then retry.");
  const [updated] = await ctx.deps.db
    .update(photos)
    .set({ uploadStatus: "uploaded", byteSize: head.size, updatedBy: ctx.auth.userId })
    .where(eq(photos.id, photoId))
    .returning();
  if (row.uploadStatus === "pending") {
    await recordActivity(ctx, {
      projectId: row.projectId,
      action: "photo.uploaded",
      entityType: "photo",
      entityId: photoId,
      summary: `uploaded a ${row.kind} photo${row.caption ? `: ${row.caption}` : ""}`,
      clientVisible: row.visibility === "client",
    });
  }
  await ctx.deps.jobs.enqueue("photo.thumbnail", { photoId }, { jobId: `thumb-${photoId}` });
  ctx.deps.events.publish({
    type: "photo.uploaded",
    organizationId: ctx.auth.organizationId,
    projectId: row.projectId,
    entityType: "photo",
    entityId: photoId,
    internal: row.visibility !== "client",
  });
  return (await withUrls(ctx.deps, [updated!]))[0]!;
}

export async function updatePhoto(ctx: Ctx, photoId: string, input: z.infer<typeof photoUpdateSchema>) {
  const row = await loadPhoto(ctx, photoId);
  if (row.createdBy !== ctx.auth.userId) await requirePermission(ctx, "photo:delete");
  if (input.visibility === "client" && ctx.auth.role === "subcontractor") throw forbidden();
  const [updated] = await ctx.deps.db.update(photos).set({ ...input, updatedBy: ctx.auth.userId }).where(eq(photos.id, photoId)).returning();
  return (await withUrls(ctx.deps, [updated!]))[0]!;
}

export async function deletePhoto(ctx: Ctx, photoId: string) {
  const row = await loadPhoto(ctx, photoId);
  if (row.createdBy !== ctx.auth.userId) await requirePermission(ctx, "photo:delete");
  await ctx.deps.db.update(photos).set({ deletedAt: new Date().toISOString(), updatedBy: ctx.auth.userId }).where(eq(photos.id, photoId));
}

/**
 * Thumbnail job: 400px JPEG next to the original. The original is kept
 * untouched (the app already compressed it before upload).
 */
export async function generateThumbnail(deps: Deps, photoId: string): Promise<void> {
  const [row] = await deps.db.select().from(photos).where(eq(photos.id, photoId));
  if (!row || !row.storageKey || row.uploadStatus === "pending") return;
  const sharp = (await import("sharp")).default;
  const original = await deps.storage.getObject(row.storageKey);
  const image = sharp(original, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const thumb = await image.resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  const thumbnailKey = storageKeys.photoThumbnail(row.organizationId, row.projectId, row.id);
  await deps.storage.putObject(thumbnailKey, thumb, "image/jpeg");
  await deps.db
    .update(photos)
    .set({ thumbnailKey, uploadStatus: "processed", width: row.width ?? meta.width ?? null, height: row.height ?? meta.height ?? null })
    .where(eq(photos.id, photoId));
}
