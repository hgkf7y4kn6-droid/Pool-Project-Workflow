import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, login, USERS, type TestApp } from "./helpers";

let t: TestApp;
let pm: ReturnType<typeof api>;
let supervisor: ReturnType<typeof api>;
let worker: ReturnType<typeof api>;
let projectId: string;

const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestApp();
  pm = api(t.app, await login(t.app, USERS.pm));
  supervisor = api(t.app, await login(t.app, USERS.super));
  worker = api(t.app, await login(t.app, USERS.worker));
});
afterAll(async () => t.close());

describe("project creation", () => {
  it("creates client, property, stages, stage tasks, checklists and dependencies in one call", async () => {
    const users = await pm.get("/users?role=field_worker");
    const crew = (await pm.get("/teams")).body.data.find((x: { name: string }) => x.name === "Crew A");
    const res = await pm.post("/projects", {
      crewTeamId: crew.id,
      name: "Nguyen Family Pool",
      type: "new_construction",
      status: "contract",
      contractAmountCents: 88_000_00,
      estimatedCostCents: 64_000_00,
      plannedStartDate: "2026-11-02",
      client: { firstName: "An", lastName: "Nguyen", email: "an@example.test", phone: "(480) 555-0199" },
      property: {
        address: { line1: "12 Palm Way", city: "Tempe", region: "AZ", postalCode: "85281", country: "US" },
        location: { latitude: 33.42, longitude: -111.94 },
      },
    });
    expect(res.status).toBe(201);
    const p = res.body.data;
    projectId = p.id;
    expect(p.number).toMatch(/^P-2026-\d{3}$/);
    expect(p.stages).toHaveLength(17);
    expect(p.clientName).toBe("An Nguyen");
    expect(p.propertyAddress).toContain("12 Palm Way");
    expect(p.plannedCompletionDate).toBeTruthy();
    expect(users.status).toBe(200);

    const schedule = await pm.get(`/projects/${projectId}/schedule`);
    expect(schedule.body.data.tasks).toHaveLength(17);
    expect(schedule.body.data.dependencies).toHaveLength(16);
    expect(schedule.body.data.violations).toEqual([]);
    expect(schedule.body.data.criticalPath.length).toBeGreaterThan(10);

    // Capture once: the same address shows up for weather.
    const weather = await pm.get(`/projects/${projectId}/weather`);
    expect(weather.status).toBe(200);
    expect(weather.body.data.daily.length).toBe(7);
  });

  it("filters the project list", async () => {
    expect((await pm.get("/projects?scope=active")).body.data.every((p: { status: string }) => ["planning", "scheduling", "procurement", "construction", "inspection", "client_approval"].includes(p.status))).toBe(true);
    expect((await pm.get("/projects?scope=completed")).body.data.map((p: { name: string }) => p.name)).toEqual(["Becker Equipment Upgrade"]);
    expect((await pm.get("/projects?city=Tempe")).body.data).toHaveLength(1);
    expect((await pm.get("/projects?type=spa")).body.data[0].name).toBe("Shah Spa Addition");
  });
});

describe("tasks and checklists", () => {
  let taskId: string;
  it("blocks completion with open mandatory checklist items", async () => {
    const created = await pm.post(`/projects/${projectId}/tasks`, {
      title: "Equipment installation",
      assigneeId: (await worker.get("/auth/me")).body.data.id,
      plannedStartDate: today,
      durationDays: 2,
      checklistTemplateKey: "equipment",
    });
    expect(created.status).toBe(201);
    taskId = created.body.data.id;
    const task = await worker.get(`/tasks/${taskId}`);
    expect(task.body.data.checklist).toHaveLength(10);

    const done = await worker.post(`/tasks/${taskId}/complete`, {});
    expect(done.status).toBe(412);
    expect(done.body.error.message).toContain("Pump installed");

    const override = await worker.post(`/tasks/${taskId}/complete`, { override: true, overrideReason: "trust me" });
    expect(override.status).toBe(403);
  });

  it("lets the assignee work the checklist but not edit task details", async () => {
    const task = await worker.get(`/tasks/${taskId}`);
    const first = task.body.data.checklist[0];
    const toggled = await worker.patch(`/checklist-items/${first.id}`, { isChecked: true });
    expect(toggled.status).toBe(200);
    expect(toggled.body.data.isChecked).toBe(true);
    expect((await worker.patch(`/tasks/${taskId}`, { status: "in_progress" })).status).toBe(200);
    expect((await worker.patch(`/tasks/${taskId}`, { title: "Renamed" })).status).toBe(403);
  });

  it("allows a supervisor override with a reason and records it", async () => {
    const res = await supervisor.post(`/tasks/${taskId}/complete`, { override: true, overrideReason: "Heater on backorder; installing next week" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("done");
    expect(res.body.data.completionOverrideReason).toContain("backorder");
    const activity = await pm.get(`/projects/${projectId}/activity`);
    expect(activity.body.data[0].summary).toContain("checklist override");
  });

  it("reports a problem, blocking the task and notifying the PM", async () => {
    const created = await pm.post(`/projects/${projectId}/tasks`, { title: "Layout", assigneeId: (await worker.get("/auth/me")).body.data.id });
    const note = await worker.post(`/tasks/${created.body.data.id}/notes`, { body: "Gas line in the dig area", isProblem: true });
    expect(note.status).toBe(201);
    expect((await pm.get(`/tasks/${created.body.data.id}`)).body.data.status).toBe("blocked");
    const notes = await pm.get("/notifications");
    expect(notes.body.data.some((n: { title: string }) => n.title.startsWith("Problem reported"))).toBe(true);
  });
});

describe("scheduling", () => {
  it("previews and applies a delay with downstream impacts", async () => {
    const schedule = await pm.get(`/projects/${projectId}/schedule`);
    const excavation = schedule.body.data.tasks.find((x: { title: string }) => x.title === "Excavation");
    const gunite = schedule.body.data.tasks.find((x: { title: string }) => x.title === "Gunite/Shotcrete");

    const preview = await pm.post(`/projects/${projectId}/schedule/shift`, { taskId: excavation.id, delayDays: 2, reason: "Rain" });
    expect(preview.body.data.applied).toBe(false);
    expect(preview.body.data.completionSlipDays).toBe(2);
    expect(preview.body.data.impacted.map((i: { id: string }) => i.id)).toContain(gunite.id);
    // Nothing moved yet.
    expect((await pm.get(`/tasks/${gunite.id}`)).body.data.plannedStartDate).toBe(gunite.plannedStartDate);

    expect((await worker.post(`/projects/${projectId}/schedule/shift`, { taskId: excavation.id, delayDays: 2, apply: true })).status).toBe(403);
    const applied = await pm.post(`/projects/${projectId}/schedule/shift`, { taskId: excavation.id, delayDays: 2, reason: "Rain", apply: true });
    expect(applied.body.data.applied).toBe(true);
    const after = await pm.get(`/tasks/${gunite.id}`);
    expect(after.body.data.plannedStartDate).toBe(preview.body.data.impacted.find((i: { id: string }) => i.id === gunite.id).proposedStart);
    const project = await pm.get(`/projects/${projectId}`);
    expect(project.body.data.projectedCompletionDate).toBe(applied.body.data.proposedFinish);
  });

  it("rejects dependency cycles", async () => {
    const schedule = await pm.get(`/projects/${projectId}/schedule`);
    const [first] = schedule.body.data.tasks.filter((x: { title: string }) => x.title === "Contract");
    const [last] = schedule.body.data.tasks.filter((x: { title: string }) => x.title === "Completion");
    const res = await pm.post(`/projects/${projectId}/dependencies`, { predecessorId: last.id, successorId: first.id, type: "FS" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("cycle");
  });

  it("returns a cross-project calendar feed", async () => {
    const res = await pm.get(`/schedule/calendar?from=2026-01-01&to=2027-12-31&projectId=${projectId}`);
    expect(res.body.data.length).toBeGreaterThan(15);
  });
});

describe("change orders", () => {
  it("runs draft → client review → signed client approval", async () => {
    const whitfield = (await pm.get("/projects?q=Whitfield")).body.data[0];
    const before = (await pm.get(`/projects/${whitfield.id}/budget`)).body.data.summary;
    const co = await pm.post(`/projects/${whitfield.id}/change-orders`, {
      title: "Add baja shelf bubblers",
      description: "Two bubblers on the sun shelf",
      costCents: 900_00,
      priceCents: 1_600_00,
      scheduleImpactDays: 1,
    });
    expect(co.status).toBe(201);
    const coId = co.body.data.id;
    expect(co.body.data.availableTransitions).toEqual(expect.arrayContaining(["submitted"]));
    expect((await pm.post(`/change-orders/${coId}/transition`, { to: "approved" })).status).toBe(400);
    expect((await pm.post(`/change-orders/${coId}/transition`, { to: "submitted" })).status).toBe(200);
    expect((await pm.post(`/change-orders/${coId}/transition`, { to: "client_review" })).status).toBe(200);

    const client = api(t.app, await login(t.app, USERS.client));
    const approvals = await client.get(`/approvals?projectId=${whitfield.id}&status=pending`);
    const approval = approvals.body.data.find((a: { subjectId: string }) => a.subjectId === coId);
    expect(approval).toBeTruthy();
    const unsigned = await client.post(`/approvals/${approval.id}/decision`, { decision: "approved" });
    expect(unsigned.status).toBe(422);
    const signed = await client.post(`/approvals/${approval.id}/decision`, {
      decision: "approved",
      signatureName: "Dana Whitfield",
      signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(signed.status).toBe(200);
    expect(signed.body.data.status).toBe("approved");

    const after = (await pm.get(`/projects/${whitfield.id}/budget`)).body.data.summary;
    expect(after.changeOrderRevenueCents - before.changeOrderRevenueCents).toBe(1_600_00);
    const payments = await pm.get(`/projects/${whitfield.id}/payments`);
    expect(payments.body.data.items.some((p: { changeOrderId: string }) => p.changeOrderId === coId)).toBe(true);

    const scheduled = await pm.post(`/change-orders/${coId}/transition`, { to: "scheduled" });
    expect(scheduled.status).toBe(200);
    const tasks = await pm.get(`/tasks?projectId=${whitfield.id}&q=bubblers`);
    expect(tasks.body.data[0].sourceChangeOrderId).toBe(coId);
  });
});

describe("inspections", () => {
  it("creates corrective tasks when an inspection fails", async () => {
    const templates = await supervisor.get("/inspection-templates");
    const tpl = templates.body.data.find((x: { inspectionType: string }) => x.inspectionType === "pre_gunite");
    const created = await supervisor.post(`/projects/${projectId}/inspections`, {
      templateId: tpl.id,
      inspectionType: "pre_gunite",
      inspectorName: "City Inspector",
      scheduledFor: today,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.items).toHaveLength(5);
    const items = created.body.data.items.map((i: { key: string }) =>
      i.key === "bonding" ? { ...i, result: "fail", notes: "Lug missing at light niche", correctiveAction: "Install bonding lug" } : { ...i, result: "pass" },
    );
    const updated = await supervisor.patch(`/inspections/${created.body.data.id}`, { items });
    expect(updated.body.data.result).toBe("partial");
    expect(updated.body.data.correctiveTaskIds).toHaveLength(1);
    const task = await pm.get(`/tasks/${updated.body.data.correctiveTaskIds[0]}`);
    expect(task.body.data.title).toBe("Correct: Equipotential bonding complete");
    expect(task.body.data.priority).toBe("urgent");
    expect(task.body.data.description).toContain("Install bonding lug");
  });
});

describe("photos and documents", () => {
  it("uploads a photo through a signed URL and generates a thumbnail", async () => {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toBuffer();
    const taskList = await worker.get(`/tasks?projectId=${projectId}&q=Excavation`);
    const created = await worker.post(`/projects/${projectId}/photos`, {
      taskId: taskList.body.data[0].id,
      kind: "progress",
      caption: "Dig started",
      takenAt: new Date().toISOString(),
      byteSize: jpeg.length,
      location: { latitude: 33.42, longitude: -111.94 },
    });
    expect(created.status).toBe(201);
    const { photo, upload } = created.body.data;
    expect(photo.stageId).toBeTruthy(); // inherited from the task
    const url = new URL(upload.url);
    const put = await t.app.inject({ method: "PUT", url: url.pathname + url.search, payload: jpeg, headers: { "content-type": "image/jpeg" } });
    expect(put.statusCode).toBe(200);
    const done = await worker.post(`/photos/${photo.id}/complete`);
    expect(done.status).toBe(200);
    await t.jobs.drain();
    const list = await pm.get(`/projects/${projectId}/photos`);
    const stored = list.body.data.find((p: { id: string }) => p.id === photo.id);
    expect(stored.uploadStatus).toBe("processed");
    expect(stored.width).toBe(1200);
    const thumb = new URL(stored.thumbnailUrl);
    const res = await t.app.inject({ method: "GET", url: thumb.pathname + thumb.search });
    expect(res.statusCode).toBe(200);
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBe(400);
    // Tampered signature is rejected.
    expect((await t.app.inject({ method: "GET", url: thumb.pathname + "?exp=9999999999&sig=bad" })).statusCode).toBe(403);
  });

  it("versions documents", async () => {
    const created = await pm.post("/documents", {
      projectId,
      title: "Engineering plans",
      category: "engineering",
      file: { fileName: "plans.pdf", mimeType: "application/pdf", byteSize: 9 },
    });
    expect(created.status).toBe(201);
    const docId = created.body.data.document.id;
    const up = new URL(created.body.data.upload.url);
    await t.app.inject({ method: "PUT", url: up.pathname + up.search, payload: Buffer.from("%PDF-1.4\n"), headers: { "content-type": "application/pdf" } });
    const done = await pm.post(`/documents/${docId}/versions/${created.body.data.version.id}/complete`);
    expect(done.body.data.currentVersion.versionNumber).toBe(1);
    expect(done.body.data.downloadUrl).toContain("/storage/local/");
    const v2 = await pm.post(`/documents/${docId}/versions`, { fileName: "plans-rev-b.pdf", mimeType: "application/pdf", byteSize: 9, notes: "Rev B" });
    const up2 = new URL(v2.body.data.upload.url);
    await t.app.inject({ method: "PUT", url: up2.pathname + up2.search, payload: Buffer.from("%PDF-1.4\n"), headers: { "content-type": "application/pdf" } });
    const done2 = await pm.post(`/documents/${docId}/versions/${v2.body.data.version.id}/complete`);
    expect(done2.body.data.versions).toHaveLength(2);
    expect(done2.body.data.currentVersion.fileName).toBe("plans-rev-b.pdf");
    const search = await pm.get("/documents?q=engineering");
    expect(search.body.data.some((d: { id: string }) => d.id === docId)).toBe(true);
    // Internal documents are hidden from clients.
    expect((await pm.post("/documents", { title: "x", category: "other", file: { fileName: "x.exe", mimeType: "application/x-msdownload", byteSize: 1 } })).status).toBe(400);
  });
});

describe("dashboards, search and reports", () => {
  it("builds the company dashboard", async () => {
    const res = await pm.get("/dashboard");
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.counts.activeProjects).toBeGreaterThan(0);
    expect(d.overdueTasks.length).toBe(d.counts.overdueTasks);
    expect(d.recentActivity.length).toBeGreaterThan(0);
    expect(d.pendingChangeOrders.length).toBeGreaterThan(0);
    expect(Array.isArray(d.budgetAlerts)).toBe(true);
  });

  it("searches across entities", async () => {
    const res = await pm.get("/search?q=whitf");
    const types = res.body.data.map((h: { type: string }) => h.type);
    expect(types).toContain("project");
    expect(types).toContain("client");
  });

  it("exports the portfolio report as JSON, CSV, XLSX and PDF", async () => {
    const json = await pm.get("/reports/portfolio");
    expect(json.body.data.metrics.activeProjects).toBeGreaterThan(0);
    expect(json.body.data.projects.length).toBeGreaterThan(2);
    const csv = await pm.get("/reports/portfolio?format=csv");
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(String(csv.raw.body).split("\n")[0]).toContain("Project #");
    const xlsx = await pm.get("/reports/portfolio?format=xlsx");
    expect(xlsx.raw.rawPayload.subarray(0, 2).toString()).toBe("PK");
    const pdf = await pm.get("/reports/portfolio?format=pdf");
    expect(pdf.raw.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await worker.get("/reports/portfolio")).status).toBe(403);
  });

  it("exports measurements for CAD", async () => {
    const whitfield = (await pm.get("/projects?q=Whitfield")).body.data[0];
    const res = await pm.get(`/projects/${whitfield.id}/measurements/export?format=json`);
    const body = JSON.parse(String(res.raw.body));
    expect(body.schema).toBe("pool-pm.measurements/v1");
    expect(body.measurements.find((m: { label: string }) => m.label === "Depth profile").geometry.type).toBe("profile");
  });
});
