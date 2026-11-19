import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { DbLike } from "@/db/types";

/**
 * Publishing a review (or a rating-only log) of an album that is in the author's queue, or
 * suggested to them, marks that entry as reviewed (S14). Runs inside the review's transaction.
 */
export async function markQueueReviewed(
  db: DbLike,
  ownerId: string,
  albumId: string,
): Promise<void> {
  await db
    .update(schema.queueItems)
    .set({ status: "reviewed" })
    .where(
      and(
        eq(schema.queueItems.ownerId, ownerId),
        eq(schema.queueItems.albumId, albumId),
        inArray(schema.queueItems.status, ["queued", "suggested"]),
      ),
    );
}
