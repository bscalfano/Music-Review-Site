import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DbLike } from "@/db/types";

/** Every job type and its payload. Add new types here and register a handler in handlers.ts. */
export type JobPayloads = {
  enrich_album: { albumId: string };
  notification_email: { notificationId: string };
};
export type JobType = keyof JobPayloads;

export type ClaimedJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

/**
 * Queue a job. With a `dedupeKey`, at most one pending job per key exists, so calling this
 * twice for the same thing is harmless. Pass a transaction as `db` to enqueue atomically.
 */
export async function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  opts: { runAt?: Date; dedupeKey?: string; db?: DbLike } = {},
): Promise<void> {
  const db = opts.db ?? getDb();
  await db
    .insert(schema.jobs)
    .values({ type, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey })
    .onConflictDoNothing();
}

/** A job held longer than this is assumed to belong to a crashed worker and is reclaimed. */
const STALE_LOCK_MINUTES = 10;

/** Atomically claims up to `limit` due jobs. SKIP LOCKED makes concurrent workers safe. */
export async function claimDueJobs(limit = 1): Promise<ClaimedJob[]> {
  const result = await getDb().execute<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE jobs SET locked_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE done_at IS NULL AND failed_at IS NULL AND run_at <= now()
        AND (locked_at IS NULL OR locked_at < now() - make_interval(mins => ${STALE_LOCK_MINUTES}))
      ORDER BY run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts
  `);
  return result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

export async function markJobDone(id: string): Promise<void> {
  await getDb().execute(
    sql`UPDATE jobs SET done_at = now(), locked_at = NULL, last_error = NULL WHERE id = ${id}`,
  );
}

/** Exponential backoff: 2, 4, 8, 16 minutes. Gives up (failed_at) once attempts are used up. */
export function retryDelayMinutes(attempts: number): number {
  return 2 ** attempts;
}

export async function markJobFailed(job: ClaimedJob, error: unknown): Promise<"retry" | "failed"> {
  const message = (
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  ).slice(0, 2000);
  const exhausted = job.attempts >= job.maxAttempts;
  await getDb().execute(
    exhausted
      ? sql`UPDATE jobs SET failed_at = now(), locked_at = NULL, last_error = ${message} WHERE id = ${job.id}`
      : sql`UPDATE jobs SET run_at = now() + make_interval(mins => ${retryDelayMinutes(job.attempts)}),
                locked_at = NULL, last_error = ${message} WHERE id = ${job.id}`,
  );
  return exhausted ? "failed" : "retry";
}
