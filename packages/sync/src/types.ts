import type {
  SyncChange,
  SyncEntityType,
  SyncOperation,
  SyncOperationKind,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncStatus,
} from "@pool/types";

/** Durable storage for queued operations (SQLite on device, memory in tests). */
export interface SyncQueueStore {
  /** All operations not yet acknowledged by the server, oldest first. */
  listUnsynced(): Promise<SyncOperation[]>;
  get(id: string): Promise<SyncOperation | null>;
  insert(op: SyncOperation): Promise<void>;
  update(op: SyncOperation): Promise<void>;
  remove(id: string): Promise<void>;
  /** Reset operations stuck "in_flight" after an app crash/kill. */
  resetInFlight(): Promise<void>;
}

/**
 * The device's local database as seen by the sync engine. Implementations
 * write server data into the same tables the UI reads from.
 */
export interface LocalDataStore {
  /** Upsert/delete pulled server rows. Must skip entities with unsynced local ops. */
  applyServerChanges(changes: SyncChange[], skip: ReadonlySet<string>): Promise<void>;
  /** Record the server's acknowledged version/record for a pushed entity. */
  applyAcknowledgement(entityType: SyncEntityType, entityId: string, version: number, record: Record<string, unknown> | null): Promise<void>;
  /** Overwrite the local record with the server's copy (conflict resolved as "keep theirs"). */
  applyServerRecord(entityType: SyncEntityType, entityId: string, record: Record<string, unknown>): Promise<void>;
  /** Remove local data for projects the user can no longer access. */
  retainProjects?(projectIds: string[]): Promise<void>;
  getCursor(): Promise<string | null>;
  setCursor(cursor: string | null): Promise<void>;
}

export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
  pull(request: SyncPullRequest): Promise<SyncPullResponse>;
}

export interface NetworkMonitor {
  isOnline(): Promise<boolean>;
  /** Subscribe to connectivity changes; returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Thrown by transports for failures where the request never got a server answer. */
export class TransportError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** 401s are not retried until the session is refreshed. */
    public readonly authFailure = false,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export type SyncPhase = "idle" | "pushing" | "pulling" | "offline" | "error";

export interface SyncState {
  phase: SyncPhase;
  online: boolean;
  pending: number;
  failed: number;
  conflicts: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface MutationInput {
  entityType: SyncEntityType;
  entityId: string;
  projectId: string | null;
  operation: SyncOperationKind;
  payload: Record<string, unknown>;
  baseVersion: number | null;
  baseValues?: Record<string, unknown> | null;
}

export interface SyncEngineOptions {
  queue: SyncQueueStore;
  local: LocalDataStore;
  transport: SyncTransport;
  network: NetworkMonitor;
  userId: string;
  deviceId: string;
  /** UUID generator (expo-crypto on device, crypto.randomUUID in Node). */
  generateId: () => string;
  now?: () => Date;
  random?: () => number;
  /** Max operations per push request. */
  batchSize?: number;
  /** Max changes per pull page. */
  pullLimit?: number;
  backoff?: BackoffOptions;
  /** Restrict pulls to these projects (offline-pinned projects). */
  projectIds?: () => string[] | undefined;
  logger?: (level: "debug" | "warn" | "error", message: string, meta?: unknown) => void;
}

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Fraction of the delay randomized (0–1) to avoid thundering herds. */
  jitter: number;
  /** After this many attempts a retryable failure stays "failed" until the user retries. */
  maxAutoRetries: number;
}

export type ConflictResolution =
  | { strategy: "keep_mine" }
  | { strategy: "keep_theirs" }
  | { strategy: "merge"; payload: Record<string, unknown> };

export type { SyncStatus };
