import { loadEnv } from "./config/env";
import { createContainer } from "./container";
import { buildApp } from "./app";
import { startInProcessScheduler } from "./services/intelligence/scheduler";
import { dailyScan, escalateStale, weeklyReview } from "./services/intelligence/service";

const env = loadEnv();
const container = createContainer(env);
const app = await buildApp(container.deps);
const { deps } = container;
// Without a worker (no Redis), the API runs the scheduled intelligence scans itself.
const inProcess = env.INTELLIGENCE_INPROCESS_SCHEDULER ? env.INTELLIGENCE_INPROCESS_SCHEDULER === "true" : !env.REDIS_URL && env.APP_ENV !== "test";
const stopScheduler =
  inProcess && env.INTELLIGENCE_ENABLED
    ? startInProcessScheduler(deps, { daily: () => dailyScan(deps), escalate: () => escalateStale(deps), weekly: () => weeklyReview(deps) })
    : () => undefined;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  stopScheduler();
  await app.close();
  await container.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: env.PORT, host: env.HOST });
