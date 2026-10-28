import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, login, USERS, type TestApp } from "./helpers";

let t: TestApp;
let pm: ReturnType<typeof api>;
let admin: ReturnType<typeof api>;

beforeAll(async () => {
  t = await createTestApp();
  pm = api(t.app, await login(t.app, USERS.pm));
  admin = api(t.app, await login(t.app, USERS.admin));
});
afterAll(async () => t.close());

async function strangerFromAnotherOrg() {
  const res = await t.app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: `stranger-${crypto.randomUUID()}@example.test`, password: "Str0ng!Passw0rd#1", fullName: "Stranger", organizationName: "Other Pools", timezone: "UTC" },
  });
  expect(res.statusCode).toBe(201);
  return api(t.app, res.json().data.tokens.accessToken);
}

describe("tenant isolation through sync", () => {
  it("does not return another organization's row in a conflict response", async () => {
    const project = (await pm.get("/projects?q=Whitfield")).body.data[0];
    const task = (await pm.get(`/tasks?projectId=${project.id}`)).body.data[0];
    const stranger = await strangerFromAnotherOrg();
    const res = await stranger.post("/sync/push", {
      deviceId: "stranger",
      operations: [
        {
          id: crypto.randomUUID(),
          projectId: project.id,
          entityType: "task",
          entityId: task.id,
          operation: "update",
          payload: { title: "changed" },
          baseVersion: 0,
          baseValues: null,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(res.status).toBe(200);
    const [result] = res.body.data.results;
    expect(result.status).toBe("rejected");
    expect(JSON.stringify(res.body)).not.toContain(task.title);
    expect(result).not.toHaveProperty("serverRecord");
  });
});

describe("change order approval is applied once", () => {
  it("creates a single payment when the same approval is sent concurrently", async () => {
    const project = (await pm.get("/projects?q=Whitfield")).body.data[0];
    const co = (await pm.post(`/projects/${project.id}/change-orders`, { title: "Concurrent approval", description: "x", costCents: 100, priceCents: 5_000_00, scheduleImpactDays: 0 })).body.data;
    await pm.post(`/change-orders/${co.id}/transition`, { to: "submitted" });
    await pm.post(`/change-orders/${co.id}/transition`, { to: "client_review" });
    const body = { to: "approved", signatureName: "Admin", signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=" };
    const results = await Promise.all(Array.from({ length: 6 }, () => admin.post(`/change-orders/${co.id}/transition`, body)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => [400, 409].includes(r.status))).toBe(true);
    const payments = (await pm.get(`/projects/${project.id}/payments`)).body.data.items.filter((p: { changeOrderId: string }) => p.changeOrderId === co.id);
    expect(payments).toHaveLength(1);
  });
});

describe("credential endpoints are rate limited per IP", () => {
  it("cannot be bypassed by varying the Authorization header", async () => {
    const limited = await createTestApp({}, { AUTH_RATE_LIMIT_MAX: "3" });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 10; i++) {
        const res = await limited.app.inject({
          method: "POST",
          url: "/auth/login",
          headers: { authorization: `Bearer junk-token-${"x".repeat(30)}-${crypto.randomUUID()}` },
          payload: { email: "nobody@example.test", password: "wrong-password-1" },
        });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3).every((c) => c === 429)).toBe(true);
    } finally {
      await limited.close();
    }
  });
});
