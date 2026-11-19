import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { realSleep, type Sleep, type Throttle } from "./http";

export class ThrottleTimeoutError extends Error {
  constructor(key: string, waitMs: number) {
    super(`Throttle "${key}": next free slot is ${Math.round(waitMs)}ms away, too long to wait`);
    this.name = "ThrottleTimeoutError";
  }
}

/**
 * Site-wide throttle shared by all serverless instances.
 *
 * Each caller atomically claims the next free time slot in `throttle_slots` (one row per key),
 * then sleeps until that slot arrives. Slots are `intervalMs` apart, so total throughput for the
 * key never exceeds 1 request per interval, no matter how many instances are running.
 *
 * MusicBrainz asks for at most 1 request/second per IP; we use a slightly larger interval.
 */
export function createDbThrottle(
  key: string,
  opts: { intervalMs?: number; maxWaitMs?: number; sleep?: Sleep } = {},
): Throttle {
  const { intervalMs = 1100, maxWaitMs = 20_000, sleep = realSleep } = opts;
  return async () => {
    const intervalSecs = intervalMs / 1000;
    const result = await getDb().execute<{ wait_ms: string }>(sql`
      INSERT INTO throttle_slots (key, next_at)
      VALUES (${key}, now() + make_interval(secs => ${intervalSecs}))
      ON CONFLICT (key) DO UPDATE
        SET next_at = GREATEST(now(), throttle_slots.next_at) + make_interval(secs => ${intervalSecs})
      RETURNING (EXTRACT(EPOCH FROM (next_at - make_interval(secs => ${intervalSecs}) - now())) * 1000)::text AS wait_ms
    `);
    const waitMs = Math.max(0, Number(result.rows[0]?.wait_ms ?? 0));
    if (waitMs > maxWaitMs) throw new ThrottleTimeoutError(key, waitMs);
    if (waitMs > 0) await sleep(waitMs);
  };
}

export const musicBrainzThrottle = () => createDbThrottle("musicbrainz", { intervalMs: 1100 });
/** iTunes Search allows roughly 20 requests/minute per IP. */
export const itunesThrottle = () =>
  createDbThrottle("itunes", { intervalMs: 3200, maxWaitMs: 10_000 });
/** Odesli allows roughly 10 requests/minute without an API key. */
export const odesliThrottle = () =>
  createDbThrottle("odesli", { intervalMs: 7000, maxWaitMs: 12_000 });
