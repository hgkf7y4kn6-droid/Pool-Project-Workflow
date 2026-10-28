import type { Deps } from "./context";
import type { JobHandler, JobName } from "./adapters/jobs";
import { deliverPush } from "./services/notifications";
import { generateThumbnail } from "./services/photos";
import { recalculateProject } from "./services/schedule";
import { scanOverdueTasks } from "./services/tasks";
import { scanWeather } from "./services/weather";
import { evaluateAndPersist } from "./services/intelligence/evaluator";
import { dailyScan, escalateStale, generateAgentBriefing, weeklyReview } from "./services/intelligence/service";

/** Background job handlers, shared by services/worker and the inline dev queue. */
export function jobHandlers(deps: Deps): Record<JobName, JobHandler> {
  return {
    "photo.thumbnail": async (data) => generateThumbnail(deps, String(data.photoId)),
    "notification.push": async (data) => deliverPush(deps, String(data.notificationId)),
    "weather.scan": async () => {
      const result = await scanWeather(deps);
      deps.log.info(result, "weather scan complete");
    },
    "tasks.overdue_scan": async () => {
      const sent = await scanOverdueTasks(deps);
      deps.log.info({ sent }, "overdue scan complete");
    },
    "project.recalculate": async (data) => recalculateProject(deps, String(data.projectId)),
    "intelligence.evaluate": async (data) => {
      const outcome = await evaluateAndPersist(deps, String(data.organizationId), String(data.projectId), { trigger: String(data.trigger ?? "event") });
      if (outcome && !outcome.skipped) deps.log.debug({ projectId: data.projectId, opened: outcome.opened, closed: outcome.closed }, "intelligence evaluated");
    },
    "intelligence.briefing": async (data) => {
      const result = await generateAgentBriefing(deps, String(data.organizationId), String(data.projectId), data.requestedBy ? String(data.requestedBy) : null);
      deps.log.info({ projectId: data.projectId, result }, "agent briefing");
    },
    "intelligence.daily_scan": async () => deps.log.info(await dailyScan(deps), "intelligence daily scan complete"),
    "intelligence.escalate": async () => deps.log.info({ escalated: await escalateStale(deps) }, "intelligence escalation complete"),
    "intelligence.weekly_review": async () => deps.log.info(await weeklyReview(deps), "intelligence weekly review complete"),
  };
}
