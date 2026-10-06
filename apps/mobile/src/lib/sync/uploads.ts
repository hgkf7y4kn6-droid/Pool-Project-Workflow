import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { api } from "../api";
import { getDb, notifyChange } from "../db/database";

/**
 * Photo upload manager. A captured photo is saved to app storage and its
 * metadata is queued like any other offline change. When the server accepts
 * the metadata it returns a signed upload URL ("ticket"); this manager PUTs
 * the file and confirms it. Files stay on the device until confirmed, and
 * failed uploads retry with backoff — the original is never discarded.
 */
interface Ticket {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export const PHOTO_DIR = `${FileSystem.documentDirectory ?? ""}photos/`;

export async function ensurePhotoDir(): Promise<void> {
  if (Platform.OS === "web") return;
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
}

/** Record that a local file belongs to a photo (called at capture time). */
export async function trackLocalPhoto(photoId: string, localUri: string, mimeType: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO uploads (photo_id, local_uri, mime_type, status, updated_at) VALUES (?, ?, ?, 'waiting_metadata', ?)
     ON CONFLICT(photo_id) DO UPDATE SET local_uri = excluded.local_uri`,
    photoId,
    localUri,
    mimeType,
    new Date().toISOString(),
  );
  notifyChange(["uploads"]);
}

export async function registerUploadTicket(photoId: string, ticket: Ticket): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE uploads SET ticket = ?, status = 'ready', next_attempt_at = NULL, updated_at = ? WHERE photo_id = ?",
    JSON.stringify(ticket),
    new Date().toISOString(),
    photoId,
  );
  notifyChange(["uploads"]);
  void processUploads();
}

export interface UploadRow {
  photo_id: string;
  local_uri: string;
  mime_type: string;
  status: "waiting_metadata" | "ready" | "uploading" | "failed" | "done";
  attempts: number;
  last_error: string | null;
  ticket: string | null;
  next_attempt_at: string | null;
}

export async function listUploads(): Promise<UploadRow[]> {
  const db = await getDb();
  return db.getAllAsync<UploadRow>("SELECT * FROM uploads WHERE status <> 'done' ORDER BY updated_at");
}

let running: Promise<void> | null = null;

export function processUploads(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const rows = await db.getAllAsync<UploadRow>(
        "SELECT * FROM uploads WHERE status IN ('ready','failed') AND ticket IS NOT NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY updated_at LIMIT 10",
        now,
      );
      for (const row of rows) await uploadOne(row);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function uploadOne(row: UploadRow): Promise<void> {
  const db = await getDb();
  const set = (status: UploadRow["status"], extra: Partial<UploadRow> = {}) =>
    db.runAsync(
      "UPDATE uploads SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, ticket = COALESCE(?, ticket), updated_at = ? WHERE photo_id = ?",
      status,
      extra.attempts ?? row.attempts,
      extra.last_error ?? null,
      extra.next_attempt_at ?? null,
      extra.ticket ?? null,
      new Date().toISOString(),
      row.photo_id,
    );
  await set("uploading");
  try {
    let ticket = JSON.parse(row.ticket!) as Ticket;
    if (Date.parse(ticket.expiresAt) < Date.now() + 60_000) {
      ticket = await api.post<Ticket>(`/photos/${row.photo_id}/upload-url`);
    }
    if (Platform.OS === "web") {
      const blob = await (await fetch(row.local_uri)).blob();
      await api.uploadToSignedUrl(ticket, blob);
    } else {
      const res = await FileSystem.uploadAsync(ticket.url, row.local_uri, {
        httpMethod: "PUT",
        headers: ticket.headers,
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      if (res.status >= 300) throw new Error(`Upload failed (${res.status})`);
    }
    await api.post(`/photos/${row.photo_id}/complete`);
    await set("done", { ticket: JSON.stringify(ticket) } as Partial<UploadRow>);
  } catch (error) {
    const attempts = row.attempts + 1;
    const delay = Math.min(2 ** attempts * 5_000, 30 * 60_000);
    await set("failed", {
      attempts,
      last_error: error instanceof Error ? error.message : String(error),
      next_attempt_at: new Date(Date.now() + delay).toISOString(),
    });
  }
  notifyChange(["uploads", "photo"]);
}
