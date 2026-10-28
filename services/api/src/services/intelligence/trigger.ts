import type { Ctx, Deps } from "../../context";

/** Activity actions that don't change what the rules see. */
const IGNORED_ACTIONS = new Set(["recommendation.updated", "communication.approved"]);

/**
 * Debounced re-evaluation after a change. Bursts of edits within the window
 * collapse into one job (same job id), and the job itself skips unchanged
 * inputs, so this is cheap to call from every write.
 */
export async function scheduleProjectEvaluation(deps: Deps, organizationId: string, projectId: string, trigger: string): Promise<void> {
  if (!deps.env.INTELLIGENCE_ENABLED || IGNORED_ACTIONS.has(trigger)) return;
  const window = deps.env.INTELLIGENCE_DEBOUNCE_MS;
  const bucket = window ? Math.floor(deps.now().getTime() / window) : deps.now().getTime();
  try {
    await deps.jobs.enqueue("intelligence.evaluate", { organizationId, projectId, trigger }, { delayMs: window, jobId: `intel-eval:${projectId}:${bucket}` });
  } catch (err) {
    // Never fail the user's write because the queue is unavailable; the daily scan catches up.
    deps.log.warn({ err, projectId }, "could not schedule intelligence evaluation");
  }
}

/** Mark a project as changed by this request (evaluated after commit), or queue now outside requests. */
export async function projectChanged(ctx: Ctx, projectId: string, trigger: string): Promise<void> {
  if (IGNORED_ACTIONS.has(trigger)) return;
  if (ctx.changedProjects) ctx.changedProjects.set(projectId, trigger);
  else await scheduleProjectEvaluation(ctx.deps, ctx.auth.organizationId, projectId, trigger);
}
