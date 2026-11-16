import type { Database } from "./index";

/** Anything that can run queries: the shared client or a transaction handle. */
export type DbLike = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
