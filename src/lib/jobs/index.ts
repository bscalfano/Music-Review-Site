import { after } from "next/server";
import { handlers, type JobHandlers } from "./handlers";
import { claimDueJobs, markJobDone, markJobFailed, type JobType } from "./queue";

export { enqueue } from "./queue";
export type { JobType, JobPayloads } from "./queue";

export type RunSummary = { ran: number; succeeded: number; retried: number; failed: number };

/**
 * Runs due jobs one at a time until `maxJobs` or the time budget is used up. The budget is
 * checked before starting each job, so a run can overshoot by the length of one job.
 */
export async function runDueJobs(
  opts: { budgetMs?: number; maxJobs?: number; handlers?: JobHandlers } = {},
): Promise<RunSummary> {
  const { budgetMs = 8_000, maxJobs = 10, handlers: registry = handlers } = opts;
  const deadline = Date.now() + budgetMs;
  const summary: RunSummary = { ran: 0, succeeded: 0, retried: 0, failed: 0 };

  while (summary.ran < maxJobs && Date.now() < deadline) {
    const [job] = await claimDueJobs(1);
    if (!job) break;
    summary.ran++;
    const handler = registry[job.type as JobType];
    try {
      if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
      await handler(job.payload as never);
      await markJobDone(job.id);
      summary.succeeded++;
    } catch (err) {
      const outcome = await markJobFailed(job, err);
      if (outcome === "failed") summary.failed++;
      else summary.retried++;
      console.error(`[jobs] ${job.type} ${job.id} attempt ${job.attempts} failed:`, err);
    }
  }
  return summary;
}

/**
 * Call from a server action or route handler after enqueueing: runs due jobs right after the
 * response is sent. Vercel's free plan only allows a daily cron, so this is what actually keeps
 * the queue moving; the daily cron is a safety net for retries.
 */
export function kickJobs(): void {
  try {
    after(() => runDueJobs({ budgetMs: 8_000, maxJobs: 3 }));
  } catch {
    // Not inside a request (scripts, tests): the cron sweep will pick the jobs up.
  }
}
