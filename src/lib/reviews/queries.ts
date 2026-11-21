import { and, asc, count, desc, eq, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/db";
import { usablePreviewUrl } from "@/lib/albums/previews";
import {
  authorFacts,
  authorVisibleTo,
  canViewContent,
  loadRelation,
  type Viewer,
} from "@/lib/social/visibility";
import { notMutedBy } from "@/lib/social/mutes";

const { reviews, users, albums, artists, tracks, albumStats, tags, reviewTags, profiles } = schema;

export type AlbumCore = {
  id: string;
  mbid: string;
  title: string;
  slug: string;
  coverKey: string | null;
  releaseDate: string | null;
  primaryType: string | null;
  genres: string[];
  enrichedAt: Date | null;
  linksResolvedAt: Date | null;
  spotifyId: string | null;
  appleMusicId: string | null;
  deezerId: string | null;
  youtubeMusicId: string | null;
  tidalId: string | null;
  artist: { id: string; name: string; slug: string };
};

export type AlbumTrack = {
  id: string;
  position: number;
  discNumber: number;
  title: string;
  durationMs: number | null;
  /** Set only when the stored clip URL is still valid. */
  previewUrl: string | null;
};

/** An album by MusicBrainz release-group ID. Only albums already in our library exist here. */
export const getAlbumByMbid = cache(async (mbid: string): Promise<AlbumCore | null> => {
  const [row] = await getDb()
    .select({
      id: albums.id,
      mbid: albums.mbid,
      title: albums.title,
      slug: albums.slug,
      coverKey: albums.coverKey,
      releaseDate: albums.releaseDate,
      primaryType: albums.primaryType,
      genres: albums.genres,
      enrichedAt: albums.enrichedAt,
      linksResolvedAt: albums.linksResolvedAt,
      spotifyId: albums.spotifyId,
      appleMusicId: albums.appleMusicId,
      deezerId: albums.deezerId,
      youtubeMusicId: albums.youtubeMusicId,
      tidalId: albums.tidalId,
      artist: { id: artists.id, name: artists.name, slug: artists.slug },
    })
    .from(albums)
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .where(eq(albums.mbid, mbid))
    .limit(1);
  return row ?? null;
});

export async function getAlbumTracks(albumId: string): Promise<AlbumTrack[]> {
  const rows = await getDb()
    .select({
      id: tracks.id,
      position: tracks.position,
      discNumber: tracks.discNumber,
      title: tracks.title,
      durationMs: tracks.durationMs,
      previewUrl: tracks.previewUrl,
      previewCheckedAt: tracks.previewCheckedAt,
    })
    .from(tracks)
    .where(eq(tracks.albumId, albumId))
    .orderBy(asc(tracks.position));
  return rows.map(({ previewCheckedAt, previewUrl, ...t }) => ({
    ...t,
    previewUrl: usablePreviewUrl({ previewUrl, previewCheckedAt }),
  }));
}

export type AlbumStatsRow = {
  ratingCount: number;
  ratingSum: number;
  histogram: number[];
  logCount: number;
  reviewCount: number;
  fanCount: number;
};

export async function getAlbumStats(albumId: string): Promise<AlbumStatsRow> {
  const [row] = await getDb().select().from(albumStats).where(eq(albumStats.albumId, albumId));
  return (
    row ?? {
      ratingCount: 0,
      ratingSum: 0,
      histogram: Array(11).fill(0),
      logCount: 0,
      reviewCount: 0,
      fanCount: 0,
    }
  );
}

// --- The signed-in user's own review ---------------------------------------------------------

export type OwnReview = typeof reviews.$inferSelect & { tags: string[] };

async function loadTags(reviewId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ name: tags.name })
    .from(reviewTags)
    .innerJoin(tags, eq(reviewTags.tagId, tags.id))
    .where(eq(reviewTags.reviewId, reviewId))
    .orderBy(asc(tags.name));
  return rows.map((r) => r.name);
}

export async function getOwnReview(authorId: string, reviewId: string): Promise<OwnReview | null> {
  const [row] = await getDb()
    .select()
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.authorId, authorId), isNull(reviews.deletedAt)))
    .limit(1);
  return row ? { ...row, tags: await loadTags(row.id) } : null;
}

export async function getOwnReviewForAlbum(
  authorId: string,
  albumId: string,
): Promise<typeof reviews.$inferSelect | null> {
  const [row] = await getDb()
    .select()
    .from(reviews)
    .where(
      and(eq(reviews.albumId, albumId), eq(reviews.authorId, authorId), isNull(reviews.deletedAt)),
    )
    .limit(1);
  return row ?? null;
}

// --- A single review page --------------------------------------------------------------------

export type ReviewPageData = {
  review: typeof reviews.$inferSelect;
  author: typeof users.$inferSelect;
  authorProfile: typeof profiles.$inferSelect | null;
  album: AlbumCore;
  tracks: AlbumTrack[];
  favoriteTrack: AlbumTrack | null;
  tags: string[];
};

/**
 * A review by author handle + slug, or null when it doesn't exist OR the viewer isn't allowed to
 * see it (the two look identical on purpose). Drafts are visible only to their author.
 */
export async function getReviewPage(
  handle: string,
  slug: string,
  viewer: Viewer,
): Promise<ReviewPageData | null> {
  const db = getDb();
  const [row] = await db
    .select({ review: reviews, author: users, authorProfile: profiles })
    .from(reviews)
    .innerJoin(users, eq(reviews.authorId, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(users.handle, handle.toLowerCase()),
        eq(reviews.slug, slug),
        isNull(reviews.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const { review, author } = row;
  const isAuthor = viewer?.id === author.id;
  if (review.status !== "published" && !isAuthor && !viewer?.isAdmin) return null;
  const relation = await loadRelation(viewer, author.id);
  if (!canViewContent(viewer, authorFacts(author), relation)) return null;

  const [album, trackList, tagNames] = await Promise.all([
    db
      .select({ mbid: albums.mbid })
      .from(albums)
      .where(eq(albums.id, review.albumId))
      .then(([a]) => getAlbumByMbid(a.mbid)),
    getAlbumTracks(review.albumId),
    loadTags(review.id),
  ]);
  if (!album) return null;
  return {
    review,
    author,
    authorProfile: row.authorProfile,
    album,
    tracks: trackList,
    favoriteTrack: trackList.find((t) => t.id === review.favoriteTrackId) ?? null,
    tags: tagNames,
  };
}

// --- Review lists (album page, "all reviews") ------------------------------------------------

export type ReviewCardData = {
  id: string;
  slug: string;
  title: string | null;
  body: string;
  rating: number | null;
  publishedAt: Date | null;
  hearts: number;
  author: { handle: string; displayName: string | null; image: string | null };
};

export type ReviewSort = "popular" | "recent";

const heartCount = sql<number>`(
  SELECT count(*)::int FROM reactions r
  WHERE r.target_type = 'review' AND r.target_id = ${reviews.id} AND r.kind = 'heart'
)`;

/** Hearts, with a gentle boost for newer reviews so fresh ones can surface (30-day half-life-ish). */
const popularity = sql<number>`(${heartCount} + exp(-extract(epoch FROM (now() - ${reviews.publishedAt})) / 2592000.0))`;

function albumReviewFilter(
  albumId: string,
  viewer: Viewer,
  excludeIds: string[] = [],
  followingOnly = false,
): SQL {
  return and(
    eq(reviews.albumId, albumId),
    eq(reviews.status, "published"),
    isNull(reviews.deletedAt),
    sql`${reviews.body} <> ''`, // rating-only logs are not "reviews"
    authorVisibleTo(viewer, users),
    excludeIds.length ? notInArray(reviews.id, excludeIds) : undefined,
    followingOnly && viewer
      ? sql`EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = ${viewer.id} AND f.followee_id = ${reviews.authorId}
            AND f.status = 'accepted'
        )`
      : undefined,
    // Anyone you've muted is left out of every list of an album's reviews.
    notMutedBy(viewer, reviews.authorId),
  )!;
}

export async function listAlbumReviews(opts: {
  albumId: string;
  viewer: Viewer;
  sort: ReviewSort;
  limit: number;
  offset?: number;
  excludeIds?: string[];
  /** Only reviews by people the viewer follows (accepted). */
  followingOnly?: boolean;
}): Promise<{ items: ReviewCardData[]; total: number }> {
  const { albumId, viewer, sort, limit, offset = 0, excludeIds, followingOnly } = opts;
  const where = albumReviewFilter(albumId, viewer, excludeIds, followingOnly);
  const db = getDb();
  const [rows, [total]] = await Promise.all([
    db
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
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .where(where)
      .orderBy(
        ...(sort === "popular"
          ? [desc(popularity), desc(reviews.id)]
          : [desc(reviews.publishedAt), desc(reviews.id)]),
      )
      .limit(limit)
      .offset(offset),
    db
      .select({ n: count() })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .where(where),
  ]);
  return {
    total: total.n,
    items: rows.map(({ handle, displayName, image, ...r }) => ({
      ...r,
      author: { handle: handle!, displayName, image },
    })),
  };
}

/** The signed-in user's own state for an album, for "Your panel". */
export async function getMyAlbumState(
  userId: string,
  albumId: string,
): Promise<{
  id: string;
  slug: string;
  rating: number | null;
  hasBody: boolean;
  status: "draft" | "published" | "hidden";
} | null> {
  const row = await getOwnReviewForAlbum(userId, albumId);
  return row
    ? {
        id: row.id,
        slug: row.slug,
        rating: row.rating,
        hasBody: row.body.trim() !== "",
        status: row.status,
      }
    : null;
}
