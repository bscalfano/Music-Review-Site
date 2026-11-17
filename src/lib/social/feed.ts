import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { usablePreviewUrl } from "@/lib/albums/previews";
import { decodeCursor, encodeCursor } from "@/lib/profiles/queries";
import { countComments } from "./comments";
import { authorVisibleTo, profileVisibleTo, type Viewer } from "./visibility";

const { reviews, users, albums, artists, tracks, follows } = schema;

export type FeedItem = {
  id: string;
  slug: string;
  title: string | null;
  body: string;
  rating: number | null;
  publishedAt: Date | null;
  hearts: number;
  comments: number;
  author: { handle: string; displayName: string | null; image: string | null };
  album: { mbid: string; slug: string; title: string; coverKey: string | null };
  artistName: string;
  clip: { trackId: string; title: string; previewUrl: string | null } | null;
};

const PAGE_SIZE = 20;

const heartCount = sql<number>`(
  SELECT count(*)::int FROM reactions r
  WHERE r.target_type = 'review' AND r.target_id = ${reviews.id} AND r.kind = 'heart'
)`;

/** Shared query: published reviews/logs matching `where`, newest first, with a (time, id) cursor. */
async function queryItems(opts: {
  where: SQL | undefined;
  viewer: Viewer;
  cursor?: string;
  limit?: number;
}): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const limit = opts.limit ?? PAGE_SIZE;
  const cursor = decodeCursor(opts.cursor);
  const rows = await getDb()
    .select({
      id: reviews.id,
      slug: reviews.slug,
      title: reviews.title,
      body: reviews.body,
      rating: reviews.rating,
      publishedAt: reviews.publishedAt,
      hearts: heartCount,
      handle: users.handle,
      displayName: users.displayName,
      image: users.image,
      albumMbid: albums.mbid,
      albumSlug: albums.slug,
      albumTitle: albums.title,
      coverKey: albums.coverKey,
      artistName: artists.name,
      trackId: tracks.id,
      trackTitle: tracks.title,
      previewUrl: tracks.previewUrl,
      previewCheckedAt: tracks.previewCheckedAt,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.authorId, users.id))
    .innerJoin(albums, eq(reviews.albumId, albums.id))
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .leftJoin(tracks, eq(reviews.clipTrackId, tracks.id))
    .where(
      and(
        eq(reviews.status, "published"),
        isNull(reviews.deletedAt),
        authorVisibleTo(opts.viewer, users),
        opts.where,
        cursor
          ? sql`(${reviews.publishedAt}, ${reviews.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(reviews.publishedAt), desc(reviews.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const commentCounts = await countComments(page.map((r) => r.id));
  const items = page.map((r): FeedItem => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    body: r.body,
    rating: r.rating,
    publishedAt: r.publishedAt,
    hearts: r.hearts,
    comments: commentCounts.get(r.id) ?? 0,
    author: { handle: r.handle!, displayName: r.displayName, image: r.image },
    album: { mbid: r.albumMbid, slug: r.albumSlug, title: r.albumTitle, coverKey: r.coverKey },
    artistName: r.artistName,
    clip: r.trackId
      ? {
          trackId: r.trackId,
          title: r.trackTitle!,
          previewUrl: usablePreviewUrl({
            previewUrl: r.previewUrl,
            previewCheckedAt: r.previewCheckedAt,
          }),
        }
      : null,
  }));
  return {
    items,
    nextCursor:
      rows.length > limit
        ? encodeCursor({
            id: page[page.length - 1].id,
            publishedAt: page[page.length - 1].publishedAt,
          })
        : null,
  };
}

/**
 * The following feed: what people the viewer follows (accepted follows only) have published,
 * newest first. Computed when read (a join on `follows`): simple and fast at this scale.
 */
export function getFollowingFeed(viewer: NonNullable<Viewer>, cursor?: string) {
  return queryItems({
    viewer,
    cursor,
    where: sql`EXISTS (
      SELECT 1 FROM follows f
      WHERE f.follower_id = ${viewer.id} AND f.followee_id = ${reviews.authorId}
        AND f.status = 'accepted'
    )`,
  });
}

/** Discover: recent written reviews from everyone. Private accounts never appear here. */
export function getDiscoverFeed(viewer: Viewer, cursor?: string) {
  return queryItems({
    viewer,
    cursor,
    where: and(eq(users.isPrivate, false), sql`${reviews.body} <> ''`),
  });
}

export async function countFollowing(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(follows)
    .where(and(eq(follows.followerId, userId), eq(follows.status, "accepted")));
  return row?.n ?? 0;
}

export type TrendingAlbum = {
  mbid: string;
  slug: string;
  title: string;
  coverKey: string | null;
  artistName: string;
  logs: number;
};

/** Albums logged most in the last 7 days, counting public accounts only. */
export async function getTrendingAlbums(limit = 8): Promise<TrendingAlbum[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const logs = sql<number>`count(*)::int`;
  return getDb()
    .select({
      mbid: albums.mbid,
      slug: albums.slug,
      title: albums.title,
      coverKey: albums.coverKey,
      artistName: artists.name,
      logs,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.authorId, users.id))
    .innerJoin(albums, eq(reviews.albumId, albums.id))
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .where(
      and(
        eq(reviews.status, "published"),
        isNull(reviews.deletedAt),
        eq(users.isPrivate, false),
        eq(users.status, "active"),
        isNull(users.deletedAt),
        sql`${reviews.publishedAt} >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .groupBy(albums.id, artists.id)
    .orderBy(desc(logs), desc(sql`max(${reviews.publishedAt})`))
    .limit(limit);
}

export type SuggestedReviewer = {
  id: string;
  handle: string;
  displayName: string | null;
  image: string | null;
  bio: string | null;
  followers: number;
  reviews: number;
};

/**
 * People worth following: public, active, with at least one published review, that the viewer
 * doesn't follow yet and hasn't blocked. The site owner comes first, then the most followed.
 */
export async function getSuggestedReviewers(
  viewer: Viewer,
  limit = 6,
): Promise<SuggestedReviewer[]> {
  const followers = sql<number>`(
    SELECT count(*)::int FROM follows f WHERE f.followee_id = ${users.id} AND f.status = 'accepted'
  )`;
  const reviewCount = sql<number>`(
    SELECT count(*)::int FROM reviews r
    WHERE r.author_id = ${users.id} AND r.status = 'published' AND r.deleted_at IS NULL
  )`;
  const rows = await getDb()
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      image: users.image,
      bio: users.bio,
      role: users.role,
      followers,
      reviews: reviewCount,
    })
    .from(users)
    .where(
      and(
        eq(users.isPrivate, false),
        sql`${users.handle} IS NOT NULL`,
        profileVisibleTo(viewer, users),
        sql`${reviewCount} > 0`,
        viewer
          ? sql`${users.id} <> ${viewer.id} AND NOT EXISTS (
              SELECT 1 FROM follows f WHERE f.follower_id = ${viewer.id} AND f.followee_id = ${users.id}
            )`
          : undefined,
      ),
    )
    .orderBy(sql`(${users.role} = 'owner') DESC`, desc(followers), desc(reviewCount))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle!,
    displayName: r.displayName,
    image: r.image,
    bio: r.bio,
    followers: r.followers,
    reviews: r.reviews,
  }));
}
