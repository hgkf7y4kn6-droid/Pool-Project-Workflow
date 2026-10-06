import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getDb, notifyChange } from "./db/database";

export interface OfflineFile {
  document_id: string;
  version_id: string;
  local_uri: string;
  file_name: string;
  mime_type: string;
  saved_at: string;
}

const DIR = `${FileSystem.documentDirectory ?? ""}documents/`;

export async function listOfflineFiles(): Promise<OfflineFile[]> {
  const db = await getDb();
  return db.getAllAsync<OfflineFile>("SELECT * FROM offline_files ORDER BY saved_at DESC");
}

export async function getOfflineFile(documentId: string): Promise<OfflineFile | null> {
  const db = await getDb();
  return (await db.getFirstAsync<OfflineFile>("SELECT * FROM offline_files WHERE document_id = ?", documentId)) ?? null;
}

/** Keep a copy of a document's current version on the device (plans, permits for the job site). */
export async function saveOffline(doc: { id: string; versionId: string; url: string; fileName: string; mimeType: string }): Promise<void> {
  if (Platform.OS === "web") return;
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  const dest = `${DIR}${doc.id}-${doc.fileName.replace(/[^\w.-]+/g, "_")}`;
  const res = await FileSystem.downloadAsync(doc.url, dest);
  if (res.status >= 300) throw new Error(`Download failed (${res.status})`);
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO offline_files (document_id, version_id, local_uri, file_name, mime_type, saved_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET version_id = excluded.version_id, local_uri = excluded.local_uri, file_name = excluded.file_name, mime_type = excluded.mime_type, saved_at = excluded.saved_at`,
    doc.id,
    doc.versionId,
    res.uri,
    doc.fileName,
    doc.mimeType,
    new Date().toISOString(),
  );
  notifyChange(["offline_files"]);
}

export async function removeOffline(documentId: string): Promise<void> {
  const file = await getOfflineFile(documentId);
  if (file && Platform.OS !== "web") await FileSystem.deleteAsync(file.local_uri, { idempotent: true });
  const db = await getDb();
  await db.runAsync("DELETE FROM offline_files WHERE document_id = ?", documentId);
  notifyChange(["offline_files"]);
}
