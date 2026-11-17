import { lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Per-user limits. Fixed windows kept in Postgres: simple, shared across serverless instances. */
export const LIMITS = {
  follow: { limit: 50, windowSec: 60 * 60 },
  comment: { limit: 10, windowSec: 60 },
  reaction: { limit: 30, windowSec: 60 },
  publish: { limit: 20, windowSec: 24 * 60 * 60 },
  quickRate: { limit: 120, windowSec: 60 * 60 },
  report: { limit: 20, windowSec: 24 * 60 * 60 },
  upload: { limit: 40, windowSec: 24 * 60 * 60 },
  export: { limit: 5, windowSec: 24 * 60 * 60 },
} as const;

export type LimitedAction = keyof typeof LIMITS;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Counts one use of `action` by `userId` and says whether it's allowed. Attempts over the limit
 * still count, so hammering doesn't get you through at the next boundary any faster.
 */
export async function checkRateLimit(
  userId: string,
  action: LimitedAction,
  now = new Date(),
): Promise<RateLimitResult> {
  const { limit, windowSec } = LIMITS[action];
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const db = getDb();

  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key: `${action}:${userId}`, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count });

  // Housekeeping: now and then, drop windows that ended long ago.
  if (Math.random() < 0.01) {
    const cutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    await db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, cutoff));
  }

  if (row.count <= limit) return { ok: true };
  return {
    ok: false,
    retryAfterSec: Math.max(
      1,
      Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
    ),
  };
}

export function rateLimitMessage(result: Extract<RateLimitResult, { ok: false }>): string {
  const s = result.retryAfterSec;
  const wait = s < 90 ? "a minute" : s < 5400 ? `${Math.ceil(s / 60)} minutes` : "a while";
  return `You're doing that too fast. Please try again in ${wait}.`;
}
