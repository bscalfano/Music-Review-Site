import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { SocialError } from "./follows";
import type { Viewer } from "./visibility";

const { mutes, users } = schema;

/**
 * Mute someone: their reviews and shelves stop appearing in your feeds. Nothing else changes, and
 * they aren't told. You can still follow them, visit their profile and find them in search.
 */
export async function muteUser(muterId: string, targetId: string): Promise<void> {
  if (muterId === targetId) throw new SocialError("invalid", "You can't mute yourself.");
  const [target] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  if (!target) throw new SocialError("not_found", "That account doesn't exist.");
  await getDb().insert(mutes).values({ muterId, mutedId: targetId }).onConflictDoNothing();
}

export async function unmuteUser(muterId: string, targetId: string): Promise<void> {
  await getDb()
    .delete(mutes)
    .where(and(eq(mutes.muterId, muterId), eq(mutes.mutedId, targetId)));
}

export async function hasMuted(muterId: string, targetId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ x: mutes.muterId })
    .from(mutes)
    .where(and(eq(mutes.muterId, muterId), eq(mutes.mutedId, targetId)))
    .limit(1);
  return !!row;
}

export async function listMuted(muterId: string) {
  return getDb()
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      image: users.image,
    })
    .from(mutes)
    .innerJoin(users, eq(mutes.mutedId, users.id))
    .where(eq(mutes.muterId, muterId))
    .orderBy(desc(mutes.createdAt));
}

/** SQL condition for feeds: the post's author is not someone `viewer` has muted. */
export function notMutedBy(viewer: Viewer, authorId: AnyPgColumn): SQL {
  if (!viewer) return sql`true`;
  return sql`NOT EXISTS (
    SELECT 1 FROM mutes m WHERE m.muter_id = ${viewer.id} AND m.muted_id = ${authorId}
  )`;
}
