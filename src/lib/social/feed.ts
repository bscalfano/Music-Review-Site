import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { usablePreviewUrl } from "@/lib/albums/previews";
import { filterConditions, sortOrder, type Filters } from "@/lib/discovery/filters";
import { decodeCursor, encodeCursor } from "@/lib/profiles/queries";
import { countComments } from "./comments";
import { getReviewHearts } from "./reactions";
import { notMutedBy } from "./mutes";
import { authorVisibleTo, profileVisibleTo, type Viewer } from "./visibility";

const { reviews, users, albums, artists, tracks, follows } = schema;

export type FeedItem = {
  id: string;
  slug: string;
  body: string;
  rating: number | null;
  publishedAt: Date | null;
  hearts: number;
  /** Whether the viewer has liked it; null when nobody is signed in. */
  viewerHearted: boolean | null;
  comments: number;
  author: { handle: string; displayName: string | null; image: string | null };
  album: { mbid: string; slug: string; title: string; coverKey: string | null };
  artistName: string;
  artistSlug: string;
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
  /** S8: non-default sorts page by `page` (offset); newest-first pages by `cursor`. */
  filters?: Filters;
  page?: number;
}): Promise<{ items: FeedItem[]; nextCursor: string | null; nextPage: number | null }> {
  const limit = opts.limit ?? PAGE_SIZE;
  const filters = opts.filters ?? { sort: "recent" as const };
  const byCursor = filters.sort === "recent";
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const cursor = byCursor ? decodeCursor(opts.cursor) : null;
  const rows = await getDb()
    .select({
      id: reviews.id,
      slug: reviews.slug,
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
      artistSlug: artists.slug,
      trackId: tracks.id,
      trackTitle: tracks.title,
      previewUrl: tracks.previewUrl,
      previewCheckedAt: tracks.previewCheckedAt,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.authorId, users.id))
    .innerJoin(albums, eq(reviews.albumId, albums.id))
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .leftJoin(tracks, eq(reviews.favoriteTrackId, tracks.id))
    .where(
      and(
        eq(reviews.status, "published"),
        isNull(reviews.deletedAt),
        authorVisibleTo(opts.viewer, users),
        opts.where,
        ...filterConditions(filters),
        cursor
          ? sql`(${reviews.publishedAt}, ${reviews.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(...sortOrder(filters.sort))
    .limit(limit + 1)
    .offset(byCursor ? 0 : (page - 1) * limit);

  const shown = rows.slice(0, limit);
  const ids = shown.map((r) => r.id);
  const [commentCounts, heartInfo] = await Promise.all([
    countComments(ids),
    opts.viewer ? getReviewHearts(ids, opts.viewer.id) : Promise.resolve(null),
  ]);
  const items = shown.map((r): FeedItem => ({
    id: r.id,
    slug: r.slug,
    body: r.body,
    rating: r.rating,
    publishedAt: r.publishedAt,
    hearts: r.hearts,
    viewerHearted: heartInfo ? (heartInfo.get(r.id)?.hearted ?? false) : null,
    comments: commentCounts.get(r.id) ?? 0,
    author: { handle: r.handle!, displayName: r.displayName, image: r.image },
    album: { mbid: r.albumMbid, slug: r.albumSlug, title: r.albumTitle, coverKey: r.coverKey },
    artistName: r.artistName,
    artistSlug: r.artistSlug,
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
  const more = rows.length > limit;
  return {
    items,
    nextCursor:
      more && byCursor
        ? encodeCursor({
            id: shown[shown.length - 1].id,
            publishedAt: shown[shown.length - 1].publishedAt,
          })
        : null,
    nextPage: more && !byCursor ? page + 1 : null,
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
    where: and(
      sql`(${reviews.authorId} = ${viewer.id} OR EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = ${viewer.id} AND f.followee_id = ${reviews.authorId}
          AND f.status = 'accepted'
      ))`,
      notMutedBy(viewer, reviews.authorId),
    ),
  });
}

/** Discover: recent written reviews from everyone. Private accounts never appear here. */
export function getDiscoverFeed(
  viewer: Viewer,
  cursor?: string,
  opts: { filters?: Filters; page?: number } = {},
) {
  return queryItems({
    viewer,
    cursor,
    ...opts,
    where: and(
      eq(users.isPrivate, false),
      sql`${reviews.body} <> ''`,
      notMutedBy(viewer, reviews.authorId),
    ),
  });
}

/**
 * S9: reviews whose title or text match a search. Uses Postgres full-text search with
 * websearch syntax (quotes, -exclusions) and the usual visibility rule.
 */
export async function getSearchReviews(viewer: Viewer, query: string, limit = 8) {
  const { items } = await queryItems({
    viewer,
    limit,
    where: sql`${reviews.searchVector} @@ websearch_to_tsquery('english', ${query})`,
  });
  return items;
}

/** S12: recent written reviews of any album by one artist. */
export async function getArtistReviews(viewer: Viewer, artistId: string, limit = 8) {
  const { items } = await queryItems({
    viewer,
    limit,
    where: and(eq(artists.id, artistId), sql`${reviews.body} <> ''`),
  });
  return items;
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

/** Written reviews for RSS: public accounts only, newest first. Anonymous viewer, so never private. */
export async function getPublicReviewsForRss(opts: { authorId?: string; limit?: number } = {}) {
  const { items } = await queryItems({
    viewer: null,
    limit: opts.limit ?? 30,
    where: and(
      eq(users.isPrivate, false),
      sql`${reviews.body} <> ''`,
      opts.authorId ? eq(reviews.authorId, opts.authorId) : undefined,
    ),
  });
  return items;
}
