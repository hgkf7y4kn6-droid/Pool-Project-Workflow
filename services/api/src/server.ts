import { loadEnv } from "./config/env";
import { createContainer } from "./container";
import { buildApp } from "./app";

const env = loadEnv();
const container = createContainer(env);
const app = await buildApp(container.deps);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await container.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: env.PORT, host: env.HOST });
