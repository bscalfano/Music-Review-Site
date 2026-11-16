/** Postgres unique_violation (SQLSTATE 23505), as surfaced through the driver. */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: unknown };
  return e.code === "23505" || (e.cause !== undefined && isUniqueViolation(e.cause));
}
