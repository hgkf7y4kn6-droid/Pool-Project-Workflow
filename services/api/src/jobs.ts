import type { Deps } from "./context";
import type { JobHandler, JobName } from "./adapters/jobs";
import { deliverPush } from "./services/notifications";
import { generateThumbnail } from "./services/photos";
import { recalculateProject } from "./services/schedule";
import { scanOverdueTasks } from "./services/tasks";
import { scanWeather } from "./services/weather";

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
  };
}
