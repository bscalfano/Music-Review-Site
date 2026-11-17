import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { authorVisibleTo, type Viewer } from "./visibility";

const { follows, users, reviews, queueItems } = schema;

export type ActivityPerson = {
  userId: string;
  handle: string;
  displayName: string | null;
  image: string | null;
  /** "log": they rated/listened/reviewed it. "queue": it's only in their queue (S14). */
  kind: "log" | "queue";
  rating: number | null;
  hasBody: boolean;
  /** Link target when kind = "log". */
  reviewSlug: string | null;
  at: Date;
};

export type FollowingActivity = {
  people: ActivityPerson[];
  /** People who logged the album (with or without a rating). */
  listened: number;
  inQueue: number;
  /** S24: average of the ratings from people you follow, in half-star units. */
  average: { sum: number; count: number } | null;
};

/**
 * What the people the viewer follows did with an album: one query over `follows` -> reviews,
 * plus queue-only entries. Every row passes the visibility rule (private accounts the viewer
 * can't see, blocks, suspended users never appear).
 */
export async function getFollowingActivity(
  albumId: string,
  viewer: Viewer,
): Promise<FollowingActivity> {
  const empty: FollowingActivity = { people: [], listened: 0, inQueue: 0, average: null };
  if (!viewer) return empty;
  const db = getDb();

  const [logs, queued] = await Promise.all([
    db
      .select({
        userId: users.id,
        handle: users.handle,
        displayName: users.displayName,
        image: users.image,
        rating: reviews.rating,
        body: reviews.body,
        slug: reviews.slug,
        at: reviews.publishedAt,
      })
      .from(follows)
      .innerJoin(users, eq(follows.followeeId, users.id))
      .innerJoin(
        reviews,
        and(
          eq(reviews.authorId, users.id),
          eq(reviews.albumId, albumId),
          eq(reviews.status, "published"),
          isNull(reviews.deletedAt),
        ),
      )
      .where(
        and(
          eq(follows.followerId, viewer.id),
          eq(follows.status, "accepted"),
          authorVisibleTo(viewer, users),
        ),
      )
      .orderBy(desc(reviews.publishedAt)),
    db
      .select({
        userId: users.id,
        handle: users.handle,
        displayName: users.displayName,
        image: users.image,
        at: queueItems.createdAt,
      })
      .from(follows)
      .innerJoin(users, eq(follows.followeeId, users.id))
      .innerJoin(
        queueItems,
        and(
          eq(queueItems.ownerId, users.id),
          eq(queueItems.albumId, albumId),
          eq(queueItems.status, "queued"),
        ),
      )
      .where(
        and(
          eq(follows.followerId, viewer.id),
          eq(follows.status, "accepted"),
          authorVisibleTo(viewer, users),
          sql`NOT EXISTS (
            SELECT 1 FROM reviews r
            WHERE r.author_id = ${users.id} AND r.album_id = ${albumId}
              AND r.status = 'published' AND r.deleted_at IS NULL
          )`,
        ),
      )
      .orderBy(desc(queueItems.createdAt)),
  ]);

  const people: ActivityPerson[] = [
    ...logs.map((r): ActivityPerson => ({
      userId: r.userId,
      handle: r.handle!,
      displayName: r.displayName,
      image: r.image,
      kind: "log",
      rating: r.rating,
      hasBody: r.body.trim() !== "",
      reviewSlug: r.slug,
      at: r.at ?? new Date(0),
    })),
    // Queue-only people go last, without stars.
    ...queued.map((r): ActivityPerson => ({
      userId: r.userId,
      handle: r.handle!,
      displayName: r.displayName,
      image: r.image,
      kind: "queue",
      rating: null,
      hasBody: false,
      reviewSlug: null,
      at: r.at,
    })),
  ];

  const rated = logs.filter((r) => r.rating !== null);
  return {
    people,
    listened: logs.length,
    inQueue: queued.length,
    average: rated.length
      ? { sum: rated.reduce((n, r) => n + (r.rating ?? 0), 0), count: rated.length }
      : null,
  };
}
