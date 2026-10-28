import { Queue } from "bullmq";

export const JOB_NAMES = [
  "photo.thumbnail",
  "notification.push",
  "weather.scan",
  "tasks.overdue_scan",
  "project.recalculate",
  "intelligence.evaluate",
  "intelligence.briefing",
  "intelligence.daily_scan",
  "intelligence.escalate",
  "intelligence.weekly_review",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobQueue {
  enqueue(name: JobName, data: Record<string, unknown>, options?: { delayMs?: number; jobId?: string }): Promise<void>;
  close(): Promise<void>;
}

export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

export const QUEUE_NAME = "pool-pm";

/** Redis-backed queue consumed by services/worker (retries with backoff). */
export class BullJobQueue implements JobQueue {
  private queue: Queue;
  constructor(redisUrl: string) {
    const url = new URL(redisUrl);
    this.queue = new Queue(QUEUE_NAME, {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        username: url.username || undefined,
        tls: url.protocol === "rediss:" ? {} : undefined,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  async enqueue(name: JobName, data: Record<string, unknown>, options?: { delayMs?: number; jobId?: string }) {
    await this.queue.add(name, data, { delay: options?.delayMs, jobId: options?.jobId });
  }
  async close() {
    await this.queue.close();
  }
}

/**
 * Development/test fallback without Redis: runs handlers in-process after the
 * current request. Failures are logged, not retried.
 */
export class InlineJobQueue implements JobQueue {
  private handlers = new Map<JobName, JobHandler>();
  private pending = new Set<Promise<void>>();
  /** Job ids queued but not yet started (same semantics as BullMQ's jobId dedupe). */
  private queuedIds = new Set<string>();
  constructor(private readonly log: (msg: string, err?: unknown) => void = () => undefined) {}

  register(name: JobName, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  async enqueue(name: JobName, data: Record<string, unknown>, options?: { delayMs?: number; jobId?: string }) {
    const handler = this.handlers.get(name);
    if (!handler) return;
    const jobId = options?.jobId;
    if (jobId) {
      if (this.queuedIds.has(jobId)) return;
      this.queuedIds.add(jobId);
    }
    const run = new Promise<void>((resolve) => setTimeout(resolve, options?.delayMs ?? 0))
      .then(() => {
        if (jobId) this.queuedIds.delete(jobId);
        return handler(data);
      })
      .catch((err) => this.log(`job ${name} failed`, err))
      .finally(() => this.pending.delete(run));
    this.pending.add(run);
  }

  /** Wait for in-process jobs (tests). */
  async drain() {
    // Let post-response hooks (which enqueue after-commit work) run first.
    await new Promise((resolve) => setImmediate(resolve));
    while (this.pending.size) {
      await Promise.all([...this.pending]);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async close() {
    await this.drain();
  }
}
