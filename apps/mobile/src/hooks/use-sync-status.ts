import type { SyncOperation } from "@pool/types";
import { SqliteQueueStore } from "@/lib/db/queue-store";
import { useLocalQuery } from "./use-local-query";

const queue = new SqliteQueueStore();

export type EntitySyncStatus = "synced" | "pending" | "failed" | "conflict";

/** Per-record sync badge: is this change only on the device, waiting, failed? */
export function useEntitySyncStatus(type: string, id: string | undefined): EntitySyncStatus {
  const { data } = useLocalQuery(
    async () => {
      if (!id) return "synced" as EntitySyncStatus;
      const ops = (await queue.listUnsynced()).filter((o) => o.entityType === type && o.entityId === id);
      if (ops.some((o) => o.status === "conflict")) return "conflict";
      if (ops.some((o) => o.status === "failed")) return "failed";
      return ops.length ? "pending" : "synced";
    },
    [type, id],
    ["sync_queue"],
  );
  return data ?? "synced";
}

export function useSyncQueue(): SyncOperation[] {
  const { data } = useLocalQuery(() => queue.listUnsynced(), [], ["sync_queue"]);
  return data ?? [];
}
