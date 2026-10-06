import { describe, expect, it } from "vitest";
import type { SyncChange, SyncPullRequest, SyncPushRequest, SyncPushResponse, SyncPullResponse, SyncPushResult } from "@pool/types";
import {
  ManualNetworkMonitor,
  MemoryLocalStore,
  MemoryQueueStore,
  SyncEngine,
  TransportError,
  computeBackoffMs,
  threeWayMerge,
  type SyncTransport,
} from "../src";

/** A tiny fake server: versioned records + scripted failures. */
class FakeServer implements SyncTransport {
  records = new Map<string, { version: number; data: Record<string, unknown> }>();
  seen = new Set<string>();
  pushes: SyncPushRequest[] = [];
  failNextPush: Error | null = null;
  reject: Record<string, { retryable: boolean }> = {};
  changes: SyncChange[] = [];
  pageSize = 2;

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    this.pushes.push(request);
    if (this.failNextPush) {
      const e = this.failNextPush;
      this.failNextPush = null;
      throw e;
    }
    const results: SyncPushResult[] = request.operations.map((op) => {
      if (this.seen.has(op.id)) return { id: op.id, status: "duplicate", version: this.records.get(op.entityId)?.version ?? null };
      const rule = this.reject[op.entityId];
      if (rule) return { id: op.id, status: "rejected", code: "forbidden", message: "Not allowed", retryable: rule.retryable };
      const current = this.records.get(op.entityId);
      if (op.operation !== "create" && current && op.baseVersion !== null && op.baseVersion !== current.version) {
        const { conflictingFields } = threeWayMerge(op.payload, op.baseValues, current.data);
        if (conflictingFields.length) {
          return { id: op.id, status: "conflict", serverVersion: current.version, serverRecord: current.data, conflictingFields };
        }
      }
      this.seen.add(op.id);
      const version = (current?.version ?? 0) + 1;
      const data = op.operation === "delete" ? {} : { ...(current?.data ?? {}), ...op.payload };
      this.records.set(op.entityId, { version, data });
      return { id: op.id, status: "applied", version, record: { ...data, version } };
    });
    return { results };
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const start = request.cursor ? Number(request.cursor) : 0;
    const page = this.changes.slice(start, start + this.pageSize);
    const next = start + page.length;
    return { changes: page, cursor: String(next), hasMore: next < this.changes.length, serverTime: new Date().toISOString() };
  }
}

function setup(online = true) {
  let now = new Date("2026-10-06T12:00:00Z");
  let n = 0;
  const server = new FakeServer();
  const queue = new MemoryQueueStore();
  const local = new MemoryLocalStore();
  const network = new ManualNetworkMonitor(online);
  const engine = new SyncEngine({
    queue,
    local,
    transport: server,
    network,
    userId: "u1",
    deviceId: "d1",
    generateId: () => `op-${++n}`,
    now: () => now,
    random: () => 0.5,
    backoff: { baseMs: 1000, maxMs: 60_000, jitter: 0, maxAutoRetries: 3 },
  });
  return {
    server,
    queue,
    local,
    network,
    engine,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const taskUpdate = (fields: Record<string, unknown>, baseVersion = 1, baseValues: Record<string, unknown> | null = null) => ({
  entityType: "task" as const,
  entityId: "t1",
  projectId: "p1",
  operation: "update" as const,
  payload: fields,
  baseVersion,
  baseValues,
});

describe("SyncEngine", () => {
  it("keeps changes queued while offline and uploads on reconnect", async () => {
    const { engine, queue, server, network, local } = setup(false);
    server.records.set("t1", { version: 1, data: { status: "todo" } });
    await engine.enqueue(taskUpdate({ status: "done" }, 1, { status: "todo" }));
    await engine.sync();
    expect(engine.getState().phase).toBe("offline");
    expect((await queue.listUnsynced())[0]!.status).toBe("pending");

    network.set(true);
    await engine.sync();
    expect(await queue.listUnsynced()).toHaveLength(0);
    expect(server.records.get("t1")).toEqual({ version: 2, data: { status: "done" } });
    expect(local.records.get("task:t1")).toMatchObject({ status: "done", version: 2 });
    expect(engine.getState()).toMatchObject({ phase: "idle", pending: 0 });
  });

  it("coalesces bursts of offline edits", async () => {
    const { engine, queue } = setup(false);
    await engine.enqueue({ ...taskUpdate({ title: "A", status: "todo" }, 0), operation: "create", baseVersion: null });
    await engine.enqueue(taskUpdate({ status: "in_progress" }));
    const ops = await queue.listUnsynced();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ operation: "create", payload: { title: "A", status: "in_progress" } });

    await engine.enqueue({ ...taskUpdate({}), operation: "delete" });
    expect(await queue.listUnsynced()).toHaveLength(0);
  });

  it("retries transport failures with exponential backoff", async () => {
    const { engine, queue, server, advance } = setup();
    server.records.set("t1", { version: 1, data: {} });
    server.failNextPush = new TransportError("Network request failed");
    await engine.enqueue(taskUpdate({ status: "done" }));
    await engine.sync();
    let [op] = await queue.listUnsynced();
    expect(op).toMatchObject({ status: "pending", retryCount: 1, lastError: "Network request failed" });
    expect(op!.nextAttemptAt).toBe("2026-10-06T12:00:01.000Z");
    expect(engine.getState().phase).toBe("offline");

    await engine.sync(); // not yet due
    expect(server.pushes).toHaveLength(1);

    advance(1000);
    await engine.sync();
    expect(await queue.listUnsynced()).toHaveLength(0);
    expect(server.pushes).toHaveLength(2);
    void op;
  });

  it("marks operations failed after the auto-retry budget and keeps them", async () => {
    const { engine, queue, server, advance } = setup();
    server.reject["t1"] = { retryable: true };
    await engine.enqueue(taskUpdate({ status: "done" }));
    for (let i = 0; i < 3; i++) {
      await engine.sync();
      advance(60_000);
    }
    const [op] = await queue.listUnsynced();
    expect(op).toMatchObject({ status: "failed", retryCount: 3, lastError: "Not allowed" });
    expect(engine.getState().failed).toBe(1);

    delete server.reject["t1"];
    await engine.retry(op!.id);
    await engine.sync();
    expect(await queue.listUnsynced()).toHaveLength(0);
  });

  it("never drops permanently rejected changes without an explicit discard", async () => {
    const { engine, queue, server } = setup();
    server.reject["t1"] = { retryable: false };
    await engine.enqueue(taskUpdate({ status: "done" }));
    await engine.sync();
    const [op] = await queue.listUnsynced();
    expect(op!.status).toBe("failed");
    const removed = await engine.discard(op!.id);
    expect(removed?.id).toBe(op!.id);
    expect(await queue.listUnsynced()).toHaveLength(0);
  });

  it("merges concurrent edits to different fields without a conflict", async () => {
    const { engine, server } = setup();
    server.records.set("t1", { version: 3, data: { status: "todo", title: "Renamed by office" } });
    await engine.enqueue(taskUpdate({ status: "done" }, 2, { status: "todo" }));
    await engine.sync();
    expect(server.records.get("t1")!.data).toEqual({ status: "done", title: "Renamed by office" });
  });

  it("surfaces true conflicts and resolves them by user choice", async () => {
    const { engine, queue, server, local } = setup();
    server.records.set("t1", { version: 3, data: { status: "blocked" } });
    await engine.enqueue(taskUpdate({ status: "done" }, 2, { status: "todo" }));
    await engine.sync();
    let [op] = await queue.listUnsynced();
    expect(op).toMatchObject({ status: "conflict" });
    expect(op!.conflict).toMatchObject({ serverVersion: 3, conflictingFields: ["status"] });
    expect(engine.getState().conflicts).toBe(1);

    await engine.resolveConflict(op!.id, { strategy: "keep_mine" });
    await engine.sync();
    expect(await queue.listUnsynced()).toHaveLength(0);
    expect(server.records.get("t1")).toEqual({ version: 4, data: { status: "done" } });

    // Second conflict: keep theirs.
    server.records.set("t1", { version: 6, data: { status: "cancelled" } });
    await engine.enqueue(taskUpdate({ status: "todo" }, 4, { status: "done" }));
    await engine.sync();
    [op] = await queue.listUnsynced();
    await engine.resolveConflict(op!.id, { strategy: "keep_theirs" });
    expect(await queue.listUnsynced()).toHaveLength(0);
    expect(local.records.get("task:t1")).toEqual({ status: "cancelled" });
  });

  it("holds later changes to an entity behind an unresolved earlier one", async () => {
    const { engine, queue, server } = setup();
    server.reject["t1"] = { retryable: false };
    await engine.enqueue(taskUpdate({ status: "done" }));
    await engine.sync();
    await engine.enqueue(taskUpdate({ title: "x" }));
    await engine.enqueue({ ...taskUpdate({ title: "other" }), entityId: "t2", baseVersion: null, operation: "create" });
    await engine.sync();
    const remaining = await queue.listUnsynced();
    expect(remaining.map((o) => [o.entityId, o.status])).toEqual([
      ["t1", "failed"],
      ["t1", "pending"],
    ]);
    expect(server.records.has("t2")).toBe(true);
  });

  it("treats a replayed operation as a duplicate (idempotent push)", async () => {
    const { engine, queue, server } = setup();
    server.records.set("t1", { version: 1, data: {} });
    await engine.enqueue(taskUpdate({ status: "done" }));
    const [op] = await queue.listUnsynced();
    server.seen.add(op!.id);
    await engine.sync();
    expect(await queue.listUnsynced()).toHaveLength(0);
    expect(server.records.get("t1")!.version).toBe(1);
  });

  it("pulls paginated changes but never overwrites unsynced local edits", async () => {
    const { engine, local, server, network } = setup();
    server.changes = [
      { entityType: "project", entityId: "p1", seq: "1", deleted: false, record: { name: "Smith Pool" } },
      { entityType: "task", entityId: "t1", seq: "2", deleted: false, record: { status: "server" } },
      { entityType: "task", entityId: "t9", seq: "3", deleted: true, record: null },
    ];
    local.records.set("task:t9", { status: "stale" });
    local.records.set("task:t1", { status: "local" });
    network.set(false);
    await engine.enqueue(taskUpdate({ status: "local" }));
    network.set(true);
    server.failNextPush = new TransportError("offline");
    await engine.sync().catch(() => undefined);
    // Push failed, so pull did not run in this cycle.
    expect(local.cursor).toBeNull();

    server.reject["t1"] = { retryable: false };
    await engine.sync();
    expect(local.records.get("project:p1")).toEqual({ name: "Smith Pool" });
    expect(local.records.get("task:t1")).toEqual({ status: "local" });
    expect(local.records.has("task:t9")).toBe(false);
    expect(local.cursor).toBe("3");
  });
});

describe("helpers", () => {
  it("computes capped exponential backoff with jitter", () => {
    const opts = { baseMs: 1000, maxMs: 10_000, jitter: 0.5, maxAutoRetries: 5 };
    expect(computeBackoffMs(1, opts, () => 0.5)).toBe(1000);
    expect(computeBackoffMs(3, opts, () => 0.5)).toBe(4000);
    expect(computeBackoffMs(10, opts, () => 0.5)).toBe(10_000);
    expect(computeBackoffMs(3, opts, () => 0)).toBe(2000);
    expect(computeBackoffMs(3, opts, () => 1)).toBe(6000);
  });

  it("three-way merges per field", () => {
    expect(threeWayMerge({ a: 2 }, { a: 1 }, { a: 1, b: 5 })).toEqual({ merged: { a: 2 }, conflictingFields: [] });
    expect(threeWayMerge({ a: 2 }, { a: 1 }, { a: 3 })).toEqual({ merged: {}, conflictingFields: ["a"] });
    expect(threeWayMerge({ a: 3 }, { a: 1 }, { a: 3 })).toEqual({ merged: { a: 3 }, conflictingFields: [] });
    expect(threeWayMerge({ a: [1, { x: 1 }] }, null, { a: [1, { x: 1 }] }).conflictingFields).toEqual([]);
    expect(threeWayMerge({ a: 1 }, null, { a: 2 }).conflictingFields).toEqual(["a"]);
  });
});
