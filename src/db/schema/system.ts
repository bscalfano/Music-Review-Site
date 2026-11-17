import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** A simple Postgres-backed job queue (see src/lib/jobs). */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    type: text().notNull(),
    payload: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** If set, at most one pending job with this key can exist (prevents duplicates). */
    dedupeKey: text(),
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    /** Set while a worker holds the job; stale locks are reclaimed after a timeout. */
    lockedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    doneAt: timestamp({ withTimezone: true }),
    /** Set when attempts are exhausted. */
    failedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_due_idx")
      .on(t.runAt)
      .where(sql`${t.doneAt} IS NULL AND ${t.failedAt} IS NULL`),
    uniqueIndex("jobs_dedupe_pending_key")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${t.doneAt} IS NULL AND ${t.failedAt} IS NULL`),
  ],
);

/** Cache for external API responses (MusicBrainz search results, etc.). */
export const externalCache = pgTable(
  "external_cache",
  {
    key: text().primaryKey(),
    value: jsonb().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index("external_cache_expires_idx").on(t.expiresAt)],
);

/**
 * Cross-instance throttle: each caller atomically claims the next free time slot for a key
 * (see src/lib/music/throttle.ts). Used to keep MusicBrainz at <= 1 request/second site-wide.
 */
export const throttleSlots = pgTable("throttle_slots", {
  key: text().primaryKey(),
  nextAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Fixed-window rate limit counters (see src/lib/social/ratelimit.ts). Old windows are swept. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
