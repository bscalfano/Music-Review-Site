import { and, desc, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SocialError } from "./follows";

const { blocks, follows, users, notifications } = schema;

/**
 * Block someone: they can no longer see your content, follow you, comment or react, and you
 * stop seeing theirs. Any follow in either direction (and any pending request) is removed, and
 * the notifications between you are cleared.
 */
export async function blockUser(blockerId: string, targetId: string): Promise<void> {
  if (blockerId === targetId) throw new SocialError("invalid", "You can't block yourself.");
  const [target] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  if (!target) throw new SocialError("not_found", "That account doesn't exist.");

  await getDb().transaction(async (tx) => {
    await tx.insert(blocks).values({ blockerId, blockedId: targetId }).onConflictDoNothing();
    await tx
      .delete(follows)
      .where(
        or(
          and(eq(follows.followerId, blockerId), eq(follows.followeeId, targetId)),
          and(eq(follows.followerId, targetId), eq(follows.followeeId, blockerId)),
        ),
      );
    await tx
      .delete(notifications)
      .where(
        or(
          and(eq(notifications.recipientId, blockerId), eq(notifications.actorId, targetId)),
          and(eq(notifications.recipientId, targetId), eq(notifications.actorId, blockerId)),
        ),
      );
  });
}

export async function unblockUser(blockerId: string, targetId: string): Promise<void> {
  await getDb()
    .delete(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, targetId)));
}

export async function hasBlocked(blockerId: string, targetId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, targetId)))
    .limit(1);
  return !!row;
}

export async function listBlocked(blockerId: string) {
  return getDb()
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      image: users.image,
    })
    .from(blocks)
    .innerJoin(users, eq(blocks.blockedId, users.id))
    .where(eq(blocks.blockerId, blockerId))
    .orderBy(desc(blocks.createdAt));
}
