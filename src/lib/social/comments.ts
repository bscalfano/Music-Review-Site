import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { avatarUrl } from "@/lib/profiles/queries";
import {
  authorFacts,
  authorVisibleTo,
  canViewContent,
  loadRelation,
  type Viewer,
} from "./visibility";
import { SocialError } from "./follows";
import { notify } from "./notifications";
import { checkRateLimit, rateLimitMessage } from "./ratelimit";

const { comments, reviews, users } = schema;

export const MAX_COMMENT = 2000;

export type Actor = { id: string; isAdmin: boolean };

/** A published review, only if `viewer` may see it. The one gate for commenting and reacting. */
export async function getViewableReview(reviewId: string, viewer: Viewer) {
  const [row] = await getDb()
    .select({ review: reviews, author: users })
    .from(reviews)
    .innerJoin(users, eq(reviews.authorId, users.id))
    .where(
      and(eq(reviews.id, reviewId), eq(reviews.status, "published"), isNull(reviews.deletedAt)),
    )
    .limit(1);
  if (!row) return null;
  const relation = await loadRelation(viewer, row.author.id);
  return canViewContent(viewer, authorFacts(row.author), relation) ? row : null;
}

function cleanBody(raw: string): string {
  const body = raw.trim();
  if (!body) throw new SocialError("invalid", "Write something first.");
  if (body.length > MAX_COMMENT) {
    throw new SocialError("invalid", `Comments can be up to ${MAX_COMMENT} characters.`);
  }
  return body;
}

export async function addComment(
  actor: Actor,
  reviewId: string,
  rawBody: string,
  parentId?: string | null,
): Promise<string> {
  const body = cleanBody(rawBody);
  const found = await getViewableReview(reviewId, actor);
  if (!found) throw new SocialError("not_found", "That review doesn't exist.");

  const db = getDb();
  let parent: typeof comments.$inferSelect | undefined;
  if (parentId) {
    [parent] = await db.select().from(comments).where(eq(comments.id, parentId)).limit(1);
    if (!parent || parent.reviewId !== reviewId || parent.deletedAt) {
      throw new SocialError("not_found", "That comment doesn't exist.");
    }
    if (parent.parentId) {
      throw new SocialError("invalid", "Replies can't be nested more than one level.");
    }
    if (parent.authorId !== actor.id) {
      const relation = await loadRelation(actor, parent.authorId);
      if (relation.blockedEitherWay)
        throw new SocialError("not_found", "That comment doesn't exist.");
    }
  }

  const limit = await checkRateLimit(actor.id, "comment");
  if (!limit.ok) throw new SocialError("rate_limited", rateLimitMessage(limit));

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(comments)
      .values({ reviewId, authorId: actor.id, parentId: parent?.id ?? null, body })
      .returning({ id: comments.id });

    if (parent) {
      await notify(
        {
          recipientId: parent.authorId,
          actorId: actor.id,
          type: "reply",
          targetType: "comment",
          targetId: created.id,
        },
        tx,
      );
    }
    if (!parent || parent.authorId !== found.review.authorId) {
      await notify(
        {
          recipientId: found.review.authorId,
          actorId: actor.id,
          type: "comment",
          targetType: "comment",
          targetId: created.id,
        },
        tx,
      );
    }
    return created.id;
  });
}

/** Only the comment's author can edit it. */
export async function editComment(actorId: string, commentId: string, rawBody: string) {
  const body = cleanBody(rawBody);
  const [row] = await getDb()
    .update(comments)
    .set({ body, editedAt: new Date() })
    .where(
      and(eq(comments.id, commentId), eq(comments.authorId, actorId), isNull(comments.deletedAt)),
    )
    .returning({ id: comments.id });
  if (!row) throw new SocialError("not_found", "That comment doesn't exist.");
}

/** The comment's author, the review's author and admins can delete (soft delete). */
export async function deleteComment(actor: Actor, commentId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ comment: comments, reviewAuthorId: reviews.authorId })
    .from(comments)
    .innerJoin(reviews, eq(comments.reviewId, reviews.id))
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
    .limit(1);
  if (!row) return false;
  const allowed =
    actor.isAdmin || row.comment.authorId === actor.id || row.reviewAuthorId === actor.id;
  if (!allowed) throw new SocialError("forbidden", "You can't delete that comment.");
  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
  return true;
}

export type CommentNode = {
  id: string;
  parentId: string | null;
  /** True for a removed comment kept only because it has replies. */
  deleted: boolean;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  /** `avatar` is the resolved image URL (client components can't resolve storage keys). */
  author: { id: string; handle: string; displayName: string | null; avatar: string | null } | null;
  hearts: number;
  hearted: boolean;
  canEdit: boolean;
  canDelete: boolean;
  replies: CommentNode[];
};

/**
 * All comments on a review as a two-level tree. Comments by people the viewer can't see (private
 * accounts they don't follow, blocks, suspended users) are left out, along with their replies.
 */
export async function listComments(
  reviewId: string,
  reviewAuthorId: string,
  viewer: Viewer,
): Promise<{ comments: CommentNode[]; total: number }> {
  const heartCount = sql<number>`(
    SELECT count(*)::int FROM reactions r
    WHERE r.target_type = 'comment' AND r.target_id = ${comments.id} AND r.kind = 'heart'
  )`;
  const viewerHearted = viewer
    ? sql<boolean>`EXISTS (
        SELECT 1 FROM reactions r
        WHERE r.target_type = 'comment' AND r.target_id = ${comments.id}
          AND r.kind = 'heart' AND r.user_id = ${viewer.id}
      )`
    : sql<boolean>`false`;

  const rows = await getDb()
    .select({
      c: comments,
      author: users,
      hearts: heartCount,
      hearted: viewerHearted,
    })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.reviewId, reviewId), authorVisibleTo(viewer, users)))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(500);

  const toNode = (r: (typeof rows)[number]): CommentNode => {
    const mine = viewer?.id === r.c.authorId;
    const deleted = r.c.deletedAt !== null;
    return {
      id: r.c.id,
      parentId: r.c.parentId,
      deleted,
      body: deleted ? "" : r.c.body,
      createdAt: r.c.createdAt,
      editedAt: r.c.editedAt,
      author: deleted
        ? null
        : {
            id: r.author.id,
            handle: r.author.handle!,
            displayName: r.author.displayName,
            avatar: avatarUrl(r.author.image),
          },
      hearts: deleted ? 0 : r.hearts,
      hearted: r.hearted,
      canEdit: mine && !deleted,
      canDelete: !deleted && !!viewer && (mine || viewer.isAdmin || viewer.id === reviewAuthorId),
      replies: [],
    };
  };

  const top = new Map<string, CommentNode>();
  for (const r of rows) if (!r.c.parentId) top.set(r.c.id, toNode(r));
  let total = 0;
  for (const r of rows) {
    if (!r.c.parentId || r.c.deletedAt) continue;
    top.get(r.c.parentId)?.replies.push(toNode(r));
  }
  const result: CommentNode[] = [];
  for (const node of top.values()) {
    // A deleted comment stays only as a placeholder if something visible hangs under it.
    if (node.deleted && node.replies.length === 0) continue;
    result.push(node);
    if (!node.deleted) total++;
    total += node.replies.length;
  }
  return { comments: result, total };
}

/** Number of live comments on each review (for cards). */
export async function countComments(reviewIds: string[]): Promise<Map<string, number>> {
  if (reviewIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ reviewId: comments.reviewId, n: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(inArray(comments.reviewId, reviewIds), isNull(comments.deletedAt)))
    .groupBy(comments.reviewId);
  return new Map(rows.map((r) => [r.reviewId, r.n]));
}
