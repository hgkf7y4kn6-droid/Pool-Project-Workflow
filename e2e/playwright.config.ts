import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests drive the real app (Expo web build) against the real API
 * and Postgres. Mobile-specific flows for iOS/Android live in ./maestro.
 *
 * Prerequisites: Postgres reachable at E2E_DATABASE_URL and `npm run build:web`.
 */
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pool_e2e";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: "http://localhost:8099",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Phone-sized viewport; native gestures are covered by the Maestro flows.
    viewport: { width: 412, height: 915 },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: [
    {
      command: "npx tsx ../services/api/src/server.ts",
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env.CI,
      env: {
        APP_ENV: "test",
        PORT: "4000",
        DATABASE_URL,
        JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-123456",
        DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
        STORAGE_DRIVER: "local",
        STORAGE_LOCAL_DIR: ".storage-e2e",
        PUBLIC_API_URL: "http://localhost:4000",
        CORS_ORIGINS: "http://localhost:8099",
        WEATHER_PROVIDER: "none",
        LOG_LEVEL: "warn",
        RATE_LIMIT_MAX: "100000",
        AUTH_RATE_LIMIT_MAX: "100000",
      },
    },
    { command: "node serve-web.mjs .web 8099", url: "http://localhost:8099", reuseExistingServer: !process.env.CI },
  ],
});
