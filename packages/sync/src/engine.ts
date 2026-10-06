import type { SyncOperation, SyncPushResult } from "@pool/types";
import { computeBackoffMs, DEFAULT_BACKOFF } from "./backoff";
import { coalesce } from "./coalesce";
import {
  TransportError,
  type BackoffOptions,
  type ConflictResolution,
  type MutationInput,
  type SyncEngineOptions,
  type SyncState,
} from "./types";

type Listener = (state: SyncState) => void;

const entityKey = (op: Pick<SyncOperation, "entityType" | "entityId">) => `${op.entityType}:${op.entityId}`;

/**
 * Offline-first synchronization engine.
 *
 * - Every local mutation becomes a durable `SyncOperation` before the UI
 *   reports success ("saved on device").
 * - `sync()` pushes ready operations in order, then pulls server changes.
 * - Operations for one entity are strictly ordered: if an earlier op is
 *   failed/in conflict, later ops for that entity wait.
 * - Network/server errors retry with exponential backoff and jitter.
 * - Conflicts and permanent rejections are kept with their details until the
 *   user resolves, retries or explicitly discards them. Nothing is ever
 *   dropped silently.
 */
export class SyncEngine {
  private readonly opts: Required<Omit<SyncEngineOptions, "projectIds" | "logger" | "backoff">> &
    Pick<SyncEngineOptions, "projectIds" | "logger"> & { backoff: BackoffOptions };
  private state: SyncState = {
    phase: "idle",
    online: true,
    pending: 0,
    failed: 0,
    conflicts: 0,
    lastSyncedAt: null,
    lastError: null,
  };
  private listeners = new Set<Listener>();
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private stopped = true;
  /** Serializes queue writes so coalescing never races with a push. */
  private queueLock: Promise<unknown> = Promise.resolve();

  constructor(options: SyncEngineOptions) {
    this.opts = {
      now: () => new Date(),
      random: Math.random,
      batchSize: 50,
      pullLimit: 500,
      ...options,
      backoff: { ...DEFAULT_BACKOFF, ...options.backoff },
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Begin background sync: on reconnect, on schedule, and for due retries. */
  async start(intervalMs = 60_000): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.opts.queue.resetInFlight();
    this.state.online = await this.opts.network.isOnline();
    this.unsubscribeNetwork = this.opts.network.subscribe((online) => {
      const wasOffline = !this.state.online;
      this.setState({ online, phase: online ? (this.state.phase === "offline" ? "idle" : this.state.phase) : "offline" });
      if (online && wasOffline) void this.sync();
    });
    const loop = async () => {
      if (this.stopped) return;
      await this.sync().catch(() => undefined);
      if (!this.stopped) this.timer = setTimeout(loop, intervalMs);
    };
    await this.refreshCounts();
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Queue a local change. The caller must already have written the change to
   * the local database; this records it for upload. Returns the queued (or
   * coalesced) operation, or null when a create+delete cancelled out.
   */
  async enqueue(input: MutationInput): Promise<SyncOperation | null> {
    const op: SyncOperation = {
      id: this.opts.generateId(),
      userId: this.opts.userId,
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      payload: input.payload,
      baseVersion: input.baseVersion,
      baseValues: input.baseValues ?? null,
      createdAt: this.opts.now().toISOString(),
      retryCount: 0,
      status: "pending",
      lastError: null,
      nextAttemptAt: null,
      conflict: null,
    };
    const result = await this.withQueueLock(async () => {
      const all = await this.opts.queue.listUnsynced();
      const latest = [...all].reverse().find((o) => entityKey(o) === entityKey(op));
      if (latest && latest.status === "pending" && latest.retryCount === 0) {
        const merged = coalesce(latest, op);
        if (merged.kind === "replace") {
          await this.opts.queue.update(merged.op);
          return merged.op;
        }
        if (merged.kind === "cancel") {
          await this.opts.queue.remove(latest.id);
          return null;
        }
      }
      await this.opts.queue.insert(op);
      return op;
    });
    await this.refreshCounts();
    if (this.state.online) this.scheduleSoon();
    return result;
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  /** Run one push+pull cycle. Concurrent callers share the running cycle. */
  sync(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerunRequested = false;
          await this.runCycle();
        } while (this.rerunRequested && !this.stopped);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async runCycle(): Promise<void> {
    const online = await this.opts.network.isOnline();
    if (!online) {
      this.setState({ online: false, phase: "offline" });
      return;
    }
    this.setState({ online: true });
    try {
      this.setState({ phase: "pushing" });
      const pushedAll = await this.pushAll();
      this.setState({ phase: "pulling" });
      await this.pullAll();
      this.setState({
        phase: "idle",
        lastSyncedAt: this.opts.now().toISOString(),
        lastError: pushedAll ? null : this.state.lastError,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.opts.logger?.("warn", "sync cycle failed", error);
      const offline = error instanceof TransportError && error.status === undefined;
      this.setState({ phase: offline ? "offline" : "error", lastError: message, online: !offline });
    } finally {
      await this.refreshCounts();
      this.scheduleNextRetry();
    }
  }

  /** Push every ready operation. Returns false if a transport error stopped the push. */
  private async pushAll(): Promise<boolean> {
    for (;;) {
      const batch = await this.withQueueLock(async () => {
        const ready = this.selectReady(await this.opts.queue.listUnsynced());
        for (const op of ready) await this.opts.queue.update({ ...op, status: "in_flight" });
        return ready;
      });
      if (batch.length === 0) return true;

      let results: SyncPushResult[];
      try {
        const response = await this.opts.transport.push({
          deviceId: this.opts.deviceId,
          operations: batch.map((op) => ({
            id: op.id,
            projectId: op.projectId,
            entityType: op.entityType,
            entityId: op.entityId,
            operation: op.operation,
            payload: op.payload,
            baseVersion: op.baseVersion,
            baseValues: op.baseValues,
            createdAt: op.createdAt,
          })),
        });
        results = response.results;
      } catch (error) {
        await this.withQueueLock(async () => {
          for (const op of batch) await this.markRetry(op, error instanceof Error ? error.message : String(error));
        });
        throw error;
      }

      const byId = new Map(results.map((r) => [r.id, r]));
      await this.withQueueLock(async () => {
        for (const op of batch) {
          const result = byId.get(op.id);
          if (!result) {
            await this.markRetry(op, "Server did not acknowledge this change");
            continue;
          }
          await this.applyResult(op, result);
        }
      });
    }
  }

  private async applyResult(op: SyncOperation, result: SyncPushResult): Promise<void> {
    const { queue, local } = this.opts;
    switch (result.status) {
      case "applied":
        await local.applyAcknowledgement(op.entityType, op.entityId, result.version, result.record);
        await queue.remove(op.id);
        await this.rebaseFollowers(op, result.version);
        return;
      case "duplicate":
        if (result.version !== null) await local.applyAcknowledgement(op.entityType, op.entityId, result.version, null);
        await queue.remove(op.id);
        if (result.version !== null) await this.rebaseFollowers(op, result.version);
        return;
      case "conflict":
        await queue.update({
          ...op,
          status: "conflict",
          lastError: `Changed on the server by someone else (${result.conflictingFields.join(", ")})`,
          conflict: {
            serverVersion: result.serverVersion,
            serverRecord: result.serverRecord,
            conflictingFields: result.conflictingFields,
            detectedAt: this.opts.now().toISOString(),
          },
        });
        return;
      case "rejected":
        if (result.retryable) await this.markRetry(op, result.message);
        else await queue.update({ ...op, status: "failed", lastError: result.message, nextAttemptAt: null });
        return;
    }
  }

  /** Later queued updates for the same entity now build on the acknowledged version. */
  private async rebaseFollowers(op: SyncOperation, version: number): Promise<void> {
    const all = await this.opts.queue.listUnsynced();
    for (const other of all) {
      if (other.id !== op.id && entityKey(other) === entityKey(op) && other.status !== "in_flight") {
        await this.opts.queue.update({ ...other, baseVersion: version });
      }
    }
  }

  private async markRetry(op: SyncOperation, message: string): Promise<void> {
    const retryCount = op.retryCount + 1;
    const exhausted = retryCount >= this.opts.backoff.maxAutoRetries;
    const delay = computeBackoffMs(retryCount, this.opts.backoff, this.opts.random);
    await this.opts.queue.update({
      ...op,
      status: exhausted ? "failed" : "pending",
      retryCount,
      lastError: message,
      nextAttemptAt: exhausted ? null : new Date(this.opts.now().getTime() + delay).toISOString(),
    });
  }

  /**
   * Pick the next batch: pending ops whose retry time has come, skipping any
   * entity that has an earlier op still unresolved (preserves causal order).
   */
  private selectReady(all: SyncOperation[]): SyncOperation[] {
    const now = this.opts.now().getTime();
    const blocked = new Set<string>();
    const ready: SyncOperation[] = [];
    for (const op of all) {
      const key = entityKey(op);
      if (blocked.has(key)) continue;
      const due = !op.nextAttemptAt || Date.parse(op.nextAttemptAt) <= now;
      if (op.status === "pending" && due) {
        ready.push(op);
        // Only one op per entity per batch keeps baseVersion chaining simple.
        blocked.add(key);
      } else {
        blocked.add(key);
      }
      if (ready.length >= this.opts.batchSize) break;
    }
    return ready;
  }

  private async pullAll(): Promise<void> {
    const { local, transport, queue } = this.opts;
    let cursor = await local.getCursor();
    for (;;) {
      const response = await transport.pull({
        cursor,
        projectIds: this.opts.projectIds?.(),
        limit: this.opts.pullLimit,
      });
      const unsynced = await queue.listUnsynced();
      const skip = new Set(unsynced.map(entityKey));
      await local.applyServerChanges(response.changes, skip);
      cursor = response.cursor;
      await local.setCursor(cursor);
      if (!response.hasMore) {
        await local.retainProjects?.(response.accessibleProjectIds);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // User-driven recovery
  // -------------------------------------------------------------------------

  async resolveConflict(opId: string, resolution: ConflictResolution): Promise<void> {
    await this.withQueueLock(async () => {
      const op = await this.opts.queue.get(opId);
      if (!op || op.status !== "conflict" || !op.conflict) throw new Error("Operation is not in conflict");
      if (resolution.strategy === "keep_theirs") {
        await this.opts.local.applyServerRecord(op.entityType, op.entityId, op.conflict.serverRecord);
        await this.opts.queue.remove(op.id);
        return;
      }
      const payload = resolution.strategy === "merge" ? resolution.payload : op.payload;
      await this.opts.queue.update({
        ...op,
        payload,
        // Re-base on the server version; the server applies it as a normal update.
        baseVersion: op.conflict.serverVersion,
        baseValues: pick(op.conflict.serverRecord, Object.keys(payload)),
        status: "pending",
        retryCount: 0,
        nextAttemptAt: null,
        lastError: null,
        conflict: null,
      });
    });
    await this.refreshCounts();
    void this.sync();
  }

  /** Retry a failed operation now (e.g. after fixing a permission problem). */
  async retry(opId: string): Promise<void> {
    await this.withQueueLock(async () => {
      const op = await this.opts.queue.get(opId);
      if (!op) return;
      await this.opts.queue.update({ ...op, status: "pending", retryCount: 0, nextAttemptAt: null });
    });
    await this.refreshCounts();
    void this.sync();
  }

  /** Explicit, user-confirmed removal of a change that cannot be synced. */
  async discard(opId: string): Promise<SyncOperation | null> {
    const removed = await this.withQueueLock(async () => {
      const op = await this.opts.queue.get(opId);
      if (!op) return null;
      if (op.status === "in_flight") throw new Error("Cannot discard a change while it is uploading");
      await this.opts.queue.remove(opId);
      this.opts.logger?.("warn", "sync operation discarded by user", { id: op.id, entity: entityKey(op) });
      return op;
    });
    await this.refreshCounts();
    return removed;
  }

  async listQueue(): Promise<SyncOperation[]> {
    return this.opts.queue.listUnsynced();
  }

  /** Forget the pull cursor so the next sync re-downloads everything visible. */
  async resetCursor(): Promise<void> {
    await this.opts.local.setCursor(null);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async refreshCounts(): Promise<void> {
    const all = await this.opts.queue.listUnsynced();
    this.setState({
      pending: all.filter((o) => o.status === "pending" || o.status === "in_flight").length,
      failed: all.filter((o) => o.status === "failed").length,
      conflicts: all.filter((o) => o.status === "conflict").length,
    });
  }

  private scheduleSoon(): void {
    if (this.stopped) return;
    setTimeout(() => void this.sync(), 250);
  }

  private scheduleNextRetry(): void {
    if (this.stopped) return;
    void this.opts.queue.listUnsynced().then((all) => {
      const next = all
        .filter((o) => o.status === "pending" && o.nextAttemptAt)
        .map((o) => Date.parse(o.nextAttemptAt!))
        .sort((a, b) => a - b)[0];
      if (next === undefined) return;
      const delay = Math.max(0, next - this.opts.now().getTime());
      setTimeout(() => void this.sync(), delay);
    });
  }

  private setState(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queueLock.then(fn, fn);
    this.queueLock = run.catch(() => undefined);
    return run;
  }
}

function pick(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = record[k] ?? null;
  return out;
}
