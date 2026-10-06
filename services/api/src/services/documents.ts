import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { documentVersions, documents, users } from "@pool/database";
import type { DocumentCreateInput } from "@pool/validation";
import { documentListQuery, documentUpdateSchema, documentVersionSchema, z } from "@pool/validation";
import type { Ctx } from "../context";
import { badRequest, notFound } from "../lib/errors";
import { decodeCursor, page } from "../lib/http";
import { storageKeys } from "../adapters/storage/types";
import { accessibleProjectIds, loadProject, requirePermission } from "./access";
import { recordActivity } from "./activity";
import { documentOut } from "./mappers";

type DocRow = typeof documents.$inferSelect;

const ALLOWED_MIME = /^(application\/pdf|image\/(jpeg|png|webp|heic)|application\/(vnd\.openxmlformats-officedocument\.[\w.]+|msword|vnd\.ms-excel)|text\/(plain|csv)|model\/(gltf-binary|gltf\+json|vnd\.usdz\+zip)|application\/(dxf|acad|x-dwg|octet-stream))$/;

async function loadDocument(ctx: Ctx, id: string): Promise<DocRow> {
  const [row] = await ctx.deps.db.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt), eq(documents.organizationId, ctx.auth.organizationId)));
  if (!row) throw notFound("Document");
  if (row.projectId) await loadProject(ctx, row.projectId);
  else if (ctx.auth.role === "client" || ctx.auth.role === "subcontractor") throw notFound("Document");
  if (ctx.auth.role === "client" && row.visibility !== "client") throw notFound("Document");
  return row;
}

export async function listDocuments(ctx: Ctx, q: z.infer<typeof documentListQuery>) {
  await requirePermission(ctx, "document:read");
  const offset = decodeCursor(q.cursor);
  const filters: (SQL | undefined)[] = [eq(documents.organizationId, ctx.auth.organizationId), isNull(documents.deletedAt)];
  if (q.projectId) {
    await loadProject(ctx, q.projectId);
    filters.push(eq(documents.projectId, q.projectId));
  } else {
    const ids = await accessibleProjectIds(ctx);
    const external = ctx.auth.role === "client" || ctx.auth.role === "subcontractor";
    // Org-wide documents (manuals, templates) are internal-only.
    filters.push(external ? (ids.length ? inArray(documents.projectId, ids) : sql`false`) : or(isNull(documents.projectId), ids.length ? inArray(documents.projectId, ids) : sql`false`));
  }
  if (ctx.auth.role === "client") filters.push(eq(documents.visibility, "client"));
  if (q.category) filters.push(eq(documents.category, q.category));
  if (q.q) {
    filters.push(
      or(
        sql`to_tsvector('simple', ${documents.title} || ' ' || coalesce(${documents.description}, '')) @@ plainto_tsquery('simple', ${q.q})`,
        sql`${documents.title} ilike ${"%" + q.q + "%"}`,
        sql`${q.q} = any(${documents.tags})`,
      ),
    );
  }
  const rows = await ctx.deps.db
    .select({ doc: documents, version: documentVersions })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
    .where(and(...filters))
    .orderBy(desc(documents.updatedAt))
    .limit(q.limit + 1)
    .offset(offset);
  return page(
    rows.map((r) => ({ ...documentOut(r.doc), currentVersion: r.version })),
    q.limit,
    offset,
  );
}

export async function getDocument(ctx: Ctx, id: string) {
  const row = await loadDocument(ctx, id);
  const versions = await ctx.deps.db
    .select({ version: documentVersions, uploadedByName: users.fullName })
    .from(documentVersions)
    .leftJoin(users, eq(users.id, documentVersions.uploadedBy))
    .where(eq(documentVersions.documentId, id))
    .orderBy(desc(documentVersions.versionNumber));
  const current = versions.find((v) => v.version.id === row.currentVersionId)?.version ?? null;
  const downloadUrl =
    current && current.uploadStatus === "uploaded"
      ? await ctx.deps.storage.createDownloadUrl(current.storageKey, { expiresInSeconds: ctx.deps.env.SIGNED_URL_TTL_SECONDS, fileName: current.fileName })
      : null;
  return {
    ...documentOut(row),
    currentVersion: current,
    downloadUrl,
    versions: versions.map((v) => ({ ...v.version, uploadedByName: v.uploadedByName })),
  };
}

async function newVersion(ctx: Ctx, doc: DocRow, file: z.infer<typeof documentVersionSchema>) {
  if (!ALLOWED_MIME.test(file.mimeType)) throw badRequest(`Unsupported file type ${file.mimeType}`);
  const [{ next } = { next: 1 }] = await ctx.deps.db
    .select({ next: sql<number>`coalesce(max(${documentVersions.versionNumber}), 0)::int + 1` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, doc.id));
  const storageKey = storageKeys.documentVersion(ctx.auth.organizationId, doc.id, next, file.fileName);
  const [version] = await ctx.deps.db
    .insert(documentVersions)
    .values({
      documentId: doc.id,
      versionNumber: next,
      storageKey,
      fileName: file.fileName,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      checksumSha256: file.checksumSha256 ?? null,
      uploadedBy: ctx.auth.userId,
      notes: file.notes ?? null,
    })
    .returning();
  const upload = await ctx.deps.storage.createUploadUrl(storageKey, { contentType: file.mimeType, expiresInSeconds: 3600 });
  return { version: version!, upload };
}

/** Create a document record + first version and return a signed upload URL. */
export async function createDocument(ctx: Ctx, input: DocumentCreateInput) {
  await requirePermission(ctx, "document:upload");
  if (input.projectId) await loadProject(ctx, input.projectId);
  const { file, ...meta } = input;
  const [doc] = await ctx.deps.db
    .insert(documents)
    .values({ ...meta, organizationId: ctx.auth.organizationId, createdBy: ctx.auth.userId, updatedBy: ctx.auth.userId })
    .returning();
  const { version, upload } = await newVersion(ctx, doc!, { ...file, notes: null });
  return { document: documentOut(doc!), version, upload };
}

export async function addDocumentVersion(ctx: Ctx, documentId: string, input: z.infer<typeof documentVersionSchema>) {
  await requirePermission(ctx, "document:upload");
  const doc = await loadDocument(ctx, documentId);
  return newVersion(ctx, doc, input);
}

/** Mark a version uploaded (after the device PUT) and make it current. */
export async function completeDocumentUpload(ctx: Ctx, documentId: string, versionId: string) {
  await requirePermission(ctx, "document:upload");
  const doc = await loadDocument(ctx, documentId);
  const [version] = await ctx.deps.db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)));
  if (!version) throw notFound("Version");
  const head = await ctx.deps.storage.head(version.storageKey);
  if (!head) throw badRequest("Upload not found in storage");
  await ctx.deps.db.transaction(async (tx) => {
    await tx.update(documentVersions).set({ uploadStatus: "uploaded", byteSize: head.size }).where(eq(documentVersions.id, versionId));
    await tx.update(documents).set({ currentVersionId: versionId, updatedBy: ctx.auth.userId }).where(eq(documents.id, documentId));
  });
  await recordActivity(ctx, {
    projectId: doc.projectId,
    action: "document.uploaded",
    entityType: "document",
    entityId: documentId,
    summary: `uploaded ${doc.title}${version.versionNumber > 1 ? ` (version ${version.versionNumber})` : ""}`,
    clientVisible: doc.visibility === "client",
  });
  return getDocument(ctx, documentId);
}

export async function updateDocument(ctx: Ctx, documentId: string, input: z.infer<typeof documentUpdateSchema>) {
  await requirePermission(ctx, "document:upload");
  await loadDocument(ctx, documentId);
  await ctx.deps.db.update(documents).set({ ...input, updatedBy: ctx.auth.userId }).where(eq(documents.id, documentId));
  return getDocument(ctx, documentId);
}

export async function deleteDocument(ctx: Ctx, documentId: string) {
  await requirePermission(ctx, "document:delete");
  await loadDocument(ctx, documentId);
  await ctx.deps.db.update(documents).set({ deletedAt: new Date().toISOString(), updatedBy: ctx.auth.userId }).where(eq(documents.id, documentId));
}
