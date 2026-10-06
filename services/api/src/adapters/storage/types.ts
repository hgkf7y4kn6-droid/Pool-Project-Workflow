/**
 * Object storage abstraction. Binary files (photos, documents, models) live
 * in object storage; Postgres stores only metadata and keys. Clients upload
 * and download directly with short-lived signed URLs, so file bytes never
 * pass through the API and private files are never publicly addressable.
 */
export interface SignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export interface StorageProvider {
  readonly driver: string;
  createUploadUrl(key: string, options: { contentType: string; expiresInSeconds: number }): Promise<SignedUpload>;
  createDownloadUrl(key: string, options: { expiresInSeconds: number; fileName?: string }): Promise<string>;
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

export const storageKeys = {
  photoOriginal: (orgId: string, projectId: string, photoId: string, ext = "jpg") =>
    `org/${orgId}/projects/${projectId}/photos/${photoId}/original.${ext}`,
  photoThumbnail: (orgId: string, projectId: string, photoId: string) =>
    `org/${orgId}/projects/${projectId}/photos/${photoId}/thumb.jpg`,
  documentVersion: (orgId: string, documentId: string, version: number, fileName: string) =>
    `org/${orgId}/documents/${documentId}/v${version}/${sanitizeFileName(fileName)}`,
  designModel: (orgId: string, designId: string, modelId: string, fileName: string) =>
    `org/${orgId}/designs/${designId}/${modelId}/${sanitizeFileName(fileName)}`,
};

export function sanitizeFileName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(-120) || "file";
}

export function extensionFor(mimeType: string): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp" }[mimeType] ?? "bin";
}
