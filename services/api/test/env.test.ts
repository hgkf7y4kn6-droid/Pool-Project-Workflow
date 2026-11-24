import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

const base = {
  DATABASE_URL: "postgres://app:pw@db.example.supabase.co:5432/postgres",
  JWT_SECRET: "test-secret-test-secret-test-secret-1234",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PUBLIC_API_URL: "https://api.example.com",
};

describe("database TLS settings", () => {
  it("refuses unverified TLS to a remote database in production", () => {
    expect(() => loadEnv({ ...base, APP_ENV: "production", DATABASE_SSL: "require" })).toThrow(/verify-full/);
    expect(() => loadEnv({ ...base, APP_ENV: "production", DATABASE_SSL: "disable" })).toThrow(/verify-full/);
  });

  it("accepts verify-full in production and local databases without TLS", () => {
    expect(() => loadEnv({ ...base, APP_ENV: "production", DATABASE_SSL: "verify-full" })).not.toThrow(/DATABASE_SSL/);
    expect(loadEnv({ ...base, APP_ENV: "development", DATABASE_URL: "postgres://postgres@localhost:5432/pool_dev" }).DATABASE_SSL).toBe("disable");
  });
});
