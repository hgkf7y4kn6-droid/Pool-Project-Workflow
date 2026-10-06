import type { PullEntityType, SyncEntityType, SyncOperationKind, SyncStatus } from "./enums";
import type { ISODateTime, UUID } from "./entities";

/**
 * A single offline mutation recorded on the device. Operations are pushed to
 * `/sync/push` in creation order; the `id` doubles as an idempotency key so a
 * retried push never applies the same change twice.
 */
export interface SyncOperation {
  id: UUID;
  userId: UUID;
  projectId: UUID | null;
  entityType: SyncEntityType;
  entityId: UUID;
  operation: SyncOperationKind;
  /** For `create`: the full record. For `update`: only the changed fields. */
  payload: Record<string, unknown>;
  /** Server version the client based this change on (null for creates). */
  baseVersion: number | null;
  /**
   * For updates: each changed field's value *before* the local edit. Lets the
   * server do a per-field three-way merge so concurrent edits to different
   * fields never conflict.
   */
  baseValues: Record<string, unknown> | null;
  createdAt: ISODateTime;
  retryCount: number;
  status: SyncStatus;
  lastError: string | null;
  nextAttemptAt: ISODateTime | null;
  /** Populated when the server reports a conflict. */
  conflict: SyncConflict | null;
}

export interface SyncConflict {
  serverVersion: number;
  serverRecord: Record<string, unknown>;
  conflictingFields: string[];
  detectedAt: ISODateTime;
}

export type SyncPushOperation = Pick<
  SyncOperation,
  "id" | "projectId" | "entityType" | "entityId" | "operation" | "payload" | "baseVersion" | "baseValues" | "createdAt"
> & {
  /** When true the client explicitly chose "keep mine" after a conflict. */
  force?: boolean;
};

export interface SyncPushRequest {
  deviceId: string;
  operations: SyncPushOperation[];
}

export type SyncPushResult =
  | { id: UUID; status: "applied"; version: number; record: Record<string, unknown> }
  | { id: UUID; status: "duplicate"; version: number | null }
  | {
      id: UUID;
      status: "conflict";
      serverVersion: number;
      serverRecord: Record<string, unknown>;
      conflictingFields: string[];
    }
  | { id: UUID; status: "rejected"; code: string; message: string; retryable: boolean };

export interface SyncPushResponse {
  results: SyncPushResult[];
}

export interface SyncPullRequest {
  /** Opaque cursor returned by the previous pull; omit for a full sync. */
  cursor?: string | null;
  /** Restrict to these projects (e.g. projects pinned for offline use). */
  projectIds?: UUID[];
  limit?: number;
}

export interface SyncChange {
  entityType: PullEntityType;
  entityId: UUID;
  /** Monotonic server change sequence for this row. */
  seq: string;
  deleted: boolean;
  record: Record<string, unknown> | null;
}

export interface SyncPullResponse {
  changes: SyncChange[];
  cursor: string;
  hasMore: boolean;
  serverTime: ISODateTime;
}
