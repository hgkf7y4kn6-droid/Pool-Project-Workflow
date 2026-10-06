import { describe, expect, it } from "vitest";
import { createProjectSchema, passwordSchema, syncPushSchema, updateProjectSchema, updateTaskSchema } from "../src";

describe("validation", () => {
  it("never applies create defaults to PATCH bodies", () => {
    expect(updateTaskSchema.parse({ title: "x" })).toEqual({ title: "x" });
    expect(updateProjectSchema.parse({ name: "y" })).toEqual({ name: "y" });
  });

  it("requires exactly one of clientId or inline client", () => {
    const base = { name: "P", type: "repair", propertyId: "11111111-1111-1111-1111-111111111111" };
    expect(createProjectSchema.safeParse(base).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, clientId: "11111111-1111-1111-1111-111111111112" }).success).toBe(true);
  });

  it("rejects completion before start", () => {
    const r = createProjectSchema.safeParse({
      name: "P",
      type: "repair",
      clientId: "11111111-1111-1111-1111-111111111111",
      propertyId: "11111111-1111-1111-1111-111111111112",
      plannedStartDate: "2026-10-10",
      plannedCompletionDate: "2026-10-01",
    });
    expect(r.success).toBe(false);
  });

  it("enforces password strength", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("longenoughpassword").success).toBe(false);
    expect(passwordSchema.safeParse("longenough123").success).toBe(true);
  });

  it("bounds sync batches", () => {
    const op = {
      id: "11111111-1111-1111-1111-111111111111",
      projectId: null,
      entityType: "task",
      entityId: "11111111-1111-1111-1111-111111111112",
      operation: "update",
      payload: {},
      baseVersion: 1,
      createdAt: "2026-10-06T12:00:00Z",
    };
    expect(syncPushSchema.parse({ deviceId: "d", operations: [op] }).operations[0]!.baseValues).toBeNull();
    expect(syncPushSchema.safeParse({ deviceId: "d", operations: Array(201).fill(op) }).success).toBe(false);
  });
});
