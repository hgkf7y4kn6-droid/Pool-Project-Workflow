import { Queue, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAME, createContainer, jobHandlers, loadEnv, type JobName } from "@pool/api";

/**
 * Background worker: thumbnails, push delivery, weather scans and overdue
 * scans. Jobs are retried with exponential backoff (see BullJobQueue); a job
 * that exhausts its attempts stays in the failed set for inspection.
 */
const env = loadEnv();
if (!env.REDIS_URL) {
  console.error("REDIS_URL is required for the worker (the API runs jobs inline without Redis).");
  process.exit(1);
}
const container = createContainer(env);
const { deps } = container;
const handlers = jobHandlers(deps);
const url = new URL(env.REDIS_URL);
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  password: url.password || undefined,
  username: url.username || undefined,
  tls: url.protocol === "rediss:" ? {} : undefined,
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const name = job.name as JobName;
    if (!JOB_NAMES.includes(name)) throw new Error(`Unknown job ${job.name}`);
    await handlers[name](job.data as Record<string, unknown>);
  },
  { connection, concurrency: 8 },
);
worker.on("failed", (job, err) => deps.log.error({ err, job: job?.name, id: job?.id, attempts: job?.attemptsMade }, "job failed"));
worker.on("completed", (job) => deps.log.debug({ job: job.name, id: job.id }, "job completed"));

// Recurring scans (idempotent: repeat jobs are keyed by name).
const scheduler = new Queue(QUEUE_NAME, { connection });
await scheduler.upsertJobScheduler("weather-scan", { pattern: "0 */3 * * *" }, { name: "weather.scan", data: {} });
await scheduler.upsertJobScheduler("overdue-scan", { pattern: "0 13 * * *" }, { name: "tasks.overdue_scan", data: {} });
deps.log.info("worker started");

const shutdown = async () => {
  await worker.close();
  await scheduler.close();
  await container.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
