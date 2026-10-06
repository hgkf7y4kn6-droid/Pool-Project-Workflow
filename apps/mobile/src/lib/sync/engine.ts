import { ApiError, NetworkError } from "@pool/api-client";
import { SyncEngine, TransportError, type SyncTransport } from "@pool/sync";
import { getJSON, kv, KV_KEYS } from "../kv";
import { api } from "../api";
import { uuid } from "../ids";
import { SqliteLocalStore } from "../db/local-store";
import { SqliteQueueStore } from "../db/queue-store";
import { netInfoMonitor } from "./network";
import { processUploads } from "./uploads";

/** Maps API client errors onto the sync engine's transport contract. */
const transport: SyncTransport = {
  async push(request) {
    try {
      return await api.syncPush(request);
    } catch (error) {
      throw toTransportError(error);
    }
  },
  async pull(request) {
    try {
      return await api.syncPull(request);
    } catch (error) {
      throw toTransportError(error);
    }
  },
};

function toTransportError(error: unknown): Error {
  if (error instanceof NetworkError) return new TransportError(error.message);
  if (error instanceof ApiError) return new TransportError(error.message, error.status, error.status === 401);
  return error instanceof Error ? error : new Error(String(error));
}

export function deviceId(): string {
  let id = kv.getString(KV_KEYS.deviceId);
  if (!id) {
    id = uuid();
    kv.set(KV_KEYS.deviceId, id);
  }
  return id;
}

let engine: SyncEngine | null = null;
let engineUser: string | null = null;

/** One engine per signed-in user. */
export function getSyncEngine(userId: string): SyncEngine {
  if (engine && engineUser === userId) return engine;
  engine?.stop();
  engine = new SyncEngine({
    queue: new SqliteQueueStore(),
    local: new SqliteLocalStore(),
    transport,
    network: netInfoMonitor,
    userId,
    deviceId: deviceId(),
    generateId: uuid,
    // Pinned projects only, when the user limited offline storage.
    projectIds: () => {
      const pinned = getJSON<string[]>(KV_KEYS.pinnedProjects, []);
      return pinned.length ? pinned : undefined;
    },
  });
  engineUser = userId;
  // Each completed sync also drains pending photo uploads.
  engine.subscribe((state) => {
    if (state.phase === "idle" && state.online) void processUploads();
  });
  return engine;
}

export function currentSyncEngine(): SyncEngine | null {
  return engine;
}

export function stopSyncEngine(): void {
  engine?.stop();
  engine = null;
  engineUser = null;
}
