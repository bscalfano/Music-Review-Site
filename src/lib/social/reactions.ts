import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getViewableReview, type Actor } from "./comments";
import { SocialError } from "./follows";
import { notify, retractNotification } from "./notifications";
import { checkRateLimit, rateLimitMessage } from "./ratelimit";
import { loadRelation } from "./visibility";

const { reactions, comments } = schema;

export type ReactionTarget = "review" | "comment";

/**
 * Toggles the viewer's heart on a review or comment. Returns the new state and count. Hearting
 * requires being able to see the thing (private accounts, blocks), and notifies its author once.
 */
export async function toggleHeart(
  actor: Actor,
  targetType: ReactionTarget,
  targetId: string,
): Promise<{ hearted: boolean; count: number }> {
  const db = getDb();
  let authorId: string;

  if (targetType === "review") {
    const found = await getViewableReview(targetId, actor);
    if (!found) throw new SocialError("not_found", "That review doesn't exist.");
    authorId = found.review.authorId;
  } else {
    const [comment] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)))
      .limit(1);
    const found = comment && (await getViewableReview(comment.reviewId, actor));
    if (!comment || !found) throw new SocialError("not_found", "That comment doesn't exist.");
    if (comment.authorId !== actor.id) {
      const relation = await loadRelation(actor, comment.authorId);
      if (relation.blockedEitherWay)
        throw new SocialError("not_found", "That comment doesn't exist.");
    }
    authorId = comment.authorId;
  }

  const limit = await checkRateLimit(actor.id, "reaction");
  if (!limit.ok) throw new SocialError("rate_limited", rateLimitMessage(limit));

  const hearted = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(reactions)
      .where(
        and(
          eq(reactions.userId, actor.id),
          eq(reactions.targetType, targetType),
          eq(reactions.targetId, targetId),
          eq(reactions.kind, "heart"),
        ),
      )
      .returning({ id: reactions.id });
    if (removed.length > 0) {
      await retractNotification(
        { recipientId: authorId, actorId: actor.id, targetType, targetId, types: ["reaction"] },
        tx,
      );
      return false;
    }
    await tx
      .insert(reactions)
      .values({ userId: actor.id, targetType, targetId, kind: "heart" })
      .onConflictDoNothing();
    await notify(
      { recipientId: authorId, actorId: actor.id, type: "reaction", targetType, targetId },
      tx,
    );
    return true;
  });

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reactions)
    .where(
      and(
        eq(reactions.targetType, targetType),
        eq(reactions.targetId, targetId),
        eq(reactions.kind, "heart"),
      ),
    );
  return { hearted, count: row?.n ?? 0 };
}

/** Heart counts, and which of them the viewer has given, for a set of reviews. */
export async function getReviewHearts(
  reviewIds: string[],
  viewerId: string | null,
): Promise<Map<string, { count: number; hearted: boolean }>> {
  const result = new Map<string, { count: number; hearted: boolean }>();
  if (reviewIds.length === 0) return result;
  const rows = await getDb()
    .select({
      id: reactions.targetId,
      count: sql<number>`count(*)::int`,
      hearted: viewerId
        ? sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`
        : sql<boolean>`false`,
    })
    .from(reactions)
    .where(
      and(
        eq(reactions.targetType, "review"),
        eq(reactions.kind, "heart"),
        inArray(reactions.targetId, reviewIds),
      ),
    )
    .groupBy(reactions.targetId);
  for (const r of rows) result.set(r.id, { count: r.count, hearted: r.hearted });
  return result;
}
