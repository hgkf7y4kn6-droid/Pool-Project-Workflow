import { sql } from "drizzle-orm";
import type { Deps } from "../../context";

const TICK_MS = 15 * 60_000;
/** UTC hour after which the daily scan runs (matches the worker's "0 12 * * *"). */
const DAILY_HOUR_UTC = 12;

/**
 * Scheduled intelligence for deployments without a worker (no REDIS_URL):
 * the API itself runs the daily scan once per UTC day and escalation hourly.
 * A Postgres advisory lock ensures only one instance runs each tick, and the
 * daily run is keyed by date in `intelligence_evaluations`, so restarts and
 * extra replicas don't repeat it. With a worker, BullMQ schedulers do this.
 */
export function startInProcessScheduler(deps: Deps, run: { daily: () => Promise<unknown>; escalate: () => Promise<unknown>; weekly: () => Promise<unknown> }): () => void {
  let lastEscalation = 0;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const [{ locked }] = (await deps.db.execute(sql`select pg_try_advisory_lock(hashtext('intel:scheduler')) as locked`)).rows as [{ locked: boolean }];
      if (!locked) return;
      try {
        const now = deps.now();
        const today = now.toISOString().slice(0, 10);
        if (now.getUTCHours() >= DAILY_HOUR_UTC) {
          const done = await deps.db.execute(sql`select 1 from intelligence_evaluations where trigger = 'daily_scan' and created_at >= ${`${today}T00:00:00Z`} limit 1`);
          if (!done.rows.length) {
            await run.daily();
            if (now.getUTCDay() === 1) await run.weekly();
          }
        }
        if (now.getTime() - lastEscalation >= 60 * 60_000) {
          lastEscalation = now.getTime();
          await run.escalate();
        }
      } finally {
        await deps.db.execute(sql`select pg_advisory_unlock(hashtext('intel:scheduler'))`);
      }
    } catch (err) {
      deps.log.error({ err }, "in-process intelligence scheduler tick failed");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  setTimeout(() => void tick(), 30_000).unref();
  return () => clearInterval(timer);
}
