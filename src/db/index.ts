import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

/**
 * Pooled Neon connection over WebSockets: supports interactive transactions, which we need
 * for keeping album_stats consistent with review writes. Node 22+ has a global WebSocket.
 */
if (typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket;
}

type Db = ReturnType<typeof createDb>;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const pool = new Pool({ connectionString: url });
  return drizzle(pool, { schema, casing: "snake_case" });
}

// Reuse one client across hot reloads in dev and across invocations in a serverless instance.
const globalForDb = globalThis as unknown as { __db?: Db };

/** Lazy so that importing this module (e.g. during `next build`) never needs a database. */
export function getDb(): Db {
  return (globalForDb.__db ??= createDb());
}

export { schema };
export type Database = Db;
