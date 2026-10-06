import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, login, USERS, type TestApp } from "./helpers";

let t: TestApp;
let worker: ReturnType<typeof api>;
let pm: ReturnType<typeof api>;
let projectId: string;

const op = (o: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  projectId,
  baseVersion: null,
  baseValues: null,
  createdAt: new Date().toISOString(),
  payload: {},
  ...o,
});

beforeAll(async () => {
  t = await createTestApp();
  worker = api(t.app, await login(t.app, USERS.worker));
  pm = api(t.app, await login(t.app, USERS.pm));
  projectId = (await pm.get("/projects?q=Whitfield")).body.data[0].id;
});
afterAll(async () => t.close());

describe("sync pull", () => {
  it("pages through visible changes with a stable cursor", async () => {
    let cursor: string | null = null;
    const seen = new Map<string, number>();
    let pages = 0;
    for (;;) {
      const res = await worker.post("/sync/pull", { cursor, limit: 100 });
      expect(res.status).toBe(200);
      for (const c of res.body.data.changes) seen.set(c.entityType, (seen.get(c.entityType) ?? 0) + 1);
      cursor = res.body.data.cursor;
      pages += 1;
      if (!res.body.data.hasMore) break;
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen.get("project")).toBeGreaterThanOrEqual(3);
    expect(seen.get("task")).toBeGreaterThan(10);
    expect(seen.has("expense")).toBe(false); // field workers do not see costs
    // Nothing new since the last cursor.
    const again = await worker.post("/sync/pull", { cursor, limit: 100 });
    expect(again.body.data.changes).toHaveLength(0);
    expect(again.body.data.accessibleProjectIds).toContain(projectId);
  });

  it("gives clients only client-visible data", async () => {
    const client = api(t.app, await login(t.app, USERS.client));
    const res = await client.post("/sync/pull", { limit: 1000 });
    const types = new Set(res.body.data.changes.map((c: { entityType: string }) => c.entityType));
    expect(types.has("task")).toBe(false);
    expect(types.has("measurement")).toBe(false);
    const project = res.body.data.changes.find((c: { entityType: string }) => c.entityType === "project");
    expect(project.record).not.toHaveProperty("estimatedCostCents");
    const messages = res.body.data.changes.filter((c: { entityType: string }) => c.entityType === "message");
    expect(messages.every((m: { record: { visibility: string } }) => m.record.visibility === "client")).toBe(true);
  });
});

describe("sync push", () => {
  it("applies offline creates idempotently", async () => {
    const taskId = crypto.randomUUID();
    const me = (await worker.get("/auth/me")).body.data;
    const create = op({ entityType: "task", entityId: taskId, operation: "create", payload: { title: "Offline punch item", assigneeId: me.id } });
    // Field workers cannot create tasks: rejected permanently, never silently dropped.
    const rejected = await worker.post("/sync/push", { deviceId: "dev-1", operations: [create] });
    expect(rejected.body.data.results[0]).toMatchObject({ status: "rejected", code: "forbidden", retryable: false });

    const supervisor = api(t.app, await login(t.app, USERS.super));
    const ok = await supervisor.post("/sync/push", { deviceId: "dev-2", operations: [create] });
    expect(ok.body.data.results[0]).toMatchObject({ status: "applied", version: 1 });
    const replay = await supervisor.post("/sync/push", { deviceId: "dev-2", operations: [create] });
    expect(replay.body.data.results[0]).toMatchObject({ status: "duplicate" });
    expect((await pm.get(`/tasks/${taskId}`)).body.data.title).toBe("Offline punch item");
  });

  it("merges non-overlapping concurrent edits and reports real conflicts", async () => {
    const task = (await worker.get(`/tasks?projectId=${projectId}&q=Relocate`)).body.data[0];
    expect(task).toBeTruthy();
    // Office renames the task (version bump) while the worker is offline.
    await pm.patch(`/tasks/${task.id}`, { description: "Updated by office" });
    const stale = await worker.post("/sync/push", {
      deviceId: "dev-1",
      operations: [op({ entityType: "task", entityId: task.id, operation: "update", baseVersion: task.version, baseValues: { status: task.status }, payload: { status: "in_progress" } })],
    });
    expect(stale.body.data.results[0].status).toBe("applied");
    const after = (await pm.get(`/tasks/${task.id}`)).body.data;
    expect(after).toMatchObject({ status: "in_progress", description: "Updated by office" });

    // Now both sides change status: conflict, with the server copy returned.
    await pm.patch(`/tasks/${task.id}`, { status: "blocked" });
    const conflict = await worker.post("/sync/push", {
      deviceId: "dev-1",
      operations: [op({ entityType: "task", entityId: task.id, operation: "update", baseVersion: after.version, baseValues: { status: "in_progress" }, payload: { status: "todo" } })],
    });
    expect(conflict.body.data.results[0]).toMatchObject({ status: "conflict", conflictingFields: ["status"] });
    expect(conflict.body.data.results[0].serverRecord.status).toBe("blocked");
  });

  it("enforces checklist rules for offline completion too", async () => {
    const task = (await worker.get(`/tasks?projectId=${projectId}&q=Steel`)).body.data.find((x: { title: string }) => x.title === "Steel/Reinforcement");
    const supervisor = api(t.app, await login(t.app, USERS.super));
    const res = await supervisor.post("/sync/push", {
      deviceId: "dev-3",
      operations: [op({ entityType: "task", entityId: task.id, operation: "update", baseVersion: task.version, payload: { status: "done" } })],
    });
    expect(res.body.data.results[0]).toMatchObject({ status: "rejected", code: "precondition_failed", retryable: false });
  });

  it("syncs offline checklist ticks, measurements, notes and photo metadata", async () => {
    const task = (await worker.get(`/tasks?projectId=${projectId}&q=Steel`)).body.data.find((x: { title: string }) => x.title === "Steel/Reinforcement");
    const detail = (await worker.get(`/tasks/${task.id}`)).body.data;
    const item = detail.checklist.find((c: { isChecked: boolean }) => !c.isChecked);
    const supervisor = api(t.app, await login(t.app, USERS.super));
    const ops = [
      op({ entityType: "checklist_item", entityId: item.id, operation: "update", baseVersion: item.version, payload: { isChecked: true } }),
      op({ entityType: "measurement", entityId: crypto.randomUUID(), operation: "create", payload: { category: "depth", label: "Deep end", value: 6.5, unit: "ft", measuredAt: new Date().toISOString() } }),
      op({ entityType: "task_note", entityId: crypto.randomUUID(), operation: "create", payload: { taskId: task.id, body: "Steel tied at north wall" } }),
      op({ entityType: "photo", entityId: crypto.randomUUID(), operation: "create", payload: { taskId: task.id, takenAt: new Date().toISOString(), byteSize: 1234, caption: "Rebar" } }),
      op({ entityType: "labor_entry", entityId: crypto.randomUUID(), operation: "create", payload: { taskId: task.id, workDate: new Date().toISOString().slice(0, 10), hours: 3 } }),
    ];
    const res = await supervisor.post("/sync/push", { deviceId: "dev-3", operations: ops });
    expect(res.body.data.results.map((r: { status: string }) => r.status)).toEqual(["applied", "applied", "applied", "applied", "applied"]);
    const photo = res.body.data.results[3].record;
    expect(photo.upload.url).toContain("/storage/local/");
    expect(photo.stageId).toBeTruthy();
  });

  it("rejects unsupported operations clearly", async () => {
    const res = await worker.post("/sync/push", {
      deviceId: "dev-1",
      operations: [op({ entityType: "message", entityId: crypto.randomUUID(), operation: "delete" })],
    });
    expect(res.body.data.results[0]).toMatchObject({ status: "rejected", code: "unsupported", retryable: false });
  });
});
