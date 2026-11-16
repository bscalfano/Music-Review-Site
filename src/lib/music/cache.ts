import { lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Minimal JSON cache so providers can be tested without a database. */
export interface JsonCache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function createDbCache(): JsonCache {
  return {
    async get<T>(key: string) {
      const [row] = await getDb()
        .select({ value: schema.externalCache.value })
        .from(schema.externalCache)
        .where(
          sql`${schema.externalCache.key} = ${key} AND ${schema.externalCache.expiresAt} > now()`,
        )
        .limit(1);
      return row?.value as T | undefined;
    },
    async set(key, value, ttlMs) {
      const expiresAt = new Date(Date.now() + ttlMs);
      await getDb()
        .insert(schema.externalCache)
        .values({ key, value, expiresAt })
        .onConflictDoUpdate({ target: schema.externalCache.key, set: { value, expiresAt } });
    },
  };
}

export function createMemoryCache(): JsonCache & { size(): number } {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get<T>(key: string) {
      const hit = store.get(key);
      if (!hit || hit.expiresAt <= Date.now()) return undefined;
      return hit.value as T;
    },
    async set(key, value, ttlMs) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    size: () => store.size,
  };
}

/** Returns the cached value for `key`, or runs `produce` and caches its result. */
export async function cached<T>(
  cache: JsonCache | undefined,
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> {
  if (!cache) return produce();
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await produce();
  await cache.set(key, value, ttlMs);
  return value;
}

/** Housekeeping: called from the job runner. */
export async function deleteExpiredCacheEntries(): Promise<void> {
  await getDb().delete(schema.externalCache).where(lt(schema.externalCache.expiresAt, new Date()));
}
