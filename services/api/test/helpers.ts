import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import pino from "pino";
import { DEMO_PASSWORD } from "@pool/database/seed";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/config/env";
import { createContainer, type Container } from "../src/container";
import { ConsoleMailer } from "../src/adapters/mail";
import { LogPushProvider } from "../src/adapters/push";
import type { InlineJobQueue } from "../src/adapters/jobs";
import type { WeatherProvider } from "../src/adapters/weather/types";

export interface TestApp {
  app: FastifyInstance;
  container: Container;
  mailer: ConsoleMailer;
  push: LogPushProvider;
  jobs: InlineJobQueue;
  close(): Promise<void>;
}

export const fakeWeather: WeatherProvider = {
  id: "fake",
  async getForecast(latitude, longitude, days) {
    const today = new Date();
    return {
      latitude,
      longitude,
      timezone: "UTC",
      provider: "fake",
      fetchedAt: today.toISOString(),
      current: { observedAt: today.toISOString(), temperatureC: 30, windSpeedKph: 10, precipitationMm: 0, weatherCode: 0, summary: "Clear" },
      daily: Array.from({ length: days }, (_, i) => {
        const date = new Date(today.getTime() + i * 86_400_000).toISOString().slice(0, 10);
        return { date, tempMinC: 20, tempMaxC: 35, precipitationProbabilityPct: 90, precipitationMm: 25, windSpeedMaxKph: 15, weatherCode: 65, summary: "Rain" };
      }),
    };
  },
};

export async function createTestApp(): Promise<TestApp> {
  const env = loadEnv({
    APP_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/pool_test",
    JWT_SECRET: "test-secret-test-secret-test-secret-1234",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: mkdtempSync(path.join(tmpdir(), "pool-storage-")),
    PUBLIC_API_URL: "http://localhost",
    LOG_LEVEL: "error",
    RATE_LIMIT_MAX: "10000",
    AUTH_RATE_LIMIT_MAX: "10000",
  });
  const mailer = new ConsoleMailer(() => undefined);
  const push = new LogPushProvider();
  const container = createContainer(env, { mailer, push, weather: fakeWeather, log: pino({ level: "error" }) });
  const app = await buildApp(container.deps);
  return {
    app,
    container,
    mailer,
    push,
    jobs: container.deps.jobs as InlineJobQueue,
    async close() {
      await app.close();
      await container.close();
    },
  };
}

export async function login(app: FastifyInstance, email: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.body}`);
  return res.json().data.tokens.accessToken as string;
}

export function api(app: FastifyInstance, token: string) {
  const call = async (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as never, headers: { authorization: `Bearer ${token}` } });
    let body: any = null;
    try {
      body = res.json();
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body, headers: res.headers, raw: res };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, payload?: unknown) => call("POST", url, payload ?? {}),
    patch: (url: string, payload?: unknown) => call("PATCH", url, payload ?? {}),
    put: (url: string, payload?: unknown) => call("PUT", url, payload ?? {}),
    del: (url: string) => call("DELETE", url),
  };
}

export const USERS = {
  admin: "admin@bluelagoon.test",
  pm: "pm@bluelagoon.test",
  designer: "designer@bluelagoon.test",
  super: "super@bluelagoon.test",
  worker: "worker@bluelagoon.test",
  worker2: "worker2@bluelagoon.test",
  sub: "sub@deserttile.test",
  client: "client@example.test",
} as const;
