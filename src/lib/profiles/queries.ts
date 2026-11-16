import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/db";
import { authorVisibleTo, type Viewer } from "@/lib/social/visibility";
import { storagePublicUrl } from "@/lib/storage/r2";
import { bannerSmallKey } from "@/lib/images/process";

const { users, profiles, follows, favoriteAlbums, albums, artists, reviews } = schema;

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;

/** Looks up a profile by (case-insensitive) handle. Visibility is decided by the caller. */
export const getProfileByHandle = cache(
  async (handle: string): Promise<{ user: UserRow; profile: ProfileRow | null } | null> => {
    const [row] = await getDb()
      .select({ user: users, profile: profiles })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.handle, handle.toLowerCase()))
      .limit(1);
    return row ?? null;
  },
);

export async function getFollowCounts(
  userId: string,
): Promise<{ followers: number; following: number }> {
  const db = getDb();
  const [[followers], [following]] = await Promise.all([
    db
      .select({ n: count() })
      .from(follows)
      .where(and(eq(follows.followeeId, userId), eq(follows.status, "accepted"))),
    db
      .select({ n: count() })
      .from(follows)
      .where(and(eq(follows.followerId, userId), eq(follows.status, "accepted"))),
  ]);
  return { followers: followers.n, following: following.n };
}

export type FavoriteAlbum = {
  position: number;
  album: { id: string; mbid: string; title: string; slug: string; coverKey: string | null };
  artistName: string;
  /** The profile owner's own rating of this album, if they've reviewed it. */
  rating: number | null;
  reviewSlug: string | null;
};

export async function getFavorites(userId: string): Promise<FavoriteAlbum[]> {
  const rows = await getDb()
    .select({
      position: favoriteAlbums.position,
      album: {
        id: albums.id,
        mbid: albums.mbid,
        title: albums.title,
        slug: albums.slug,
        coverKey: albums.coverKey,
      },
      artistName: artists.name,
      rating: reviews.rating,
      reviewSlug: reviews.slug,
    })
    .from(favoriteAlbums)
    .innerJoin(albums, eq(favoriteAlbums.albumId, albums.id))
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .leftJoin(
      reviews,
      and(
        eq(reviews.albumId, albums.id),
        eq(reviews.authorId, userId),
        eq(reviews.status, "published"),
        isNull(reviews.deletedAt),
      ),
    )
    .where(eq(favoriteAlbums.userId, userId))
    .orderBy(asc(favoriteAlbums.position));
  return rows;
}

export type GridItem = {
  id: string;
  slug: string;
  rating: number | null;
  hasBody: boolean;
  publishedAt: Date | null;
  album: { mbid: string; title: string; coverKey: string | null };
  artistName: string;
};

const GRID_PAGE_SIZE = 48;

export const encodeCursor = (item: Pick<GridItem, "id" | "publishedAt">) =>
  `${(item.publishedAt ?? new Date(0)).toISOString()}_${item.id}`;

export function decodeCursor(raw: string | undefined): { at: string; id: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([0-9a-f-]{36})$/i.exec(raw ?? "");
  return m ? { at: m[1], id: m[2] } : null;
}

/** A user's published reviews/logs, newest first, filtered through the visibility rule. */
export async function getProfileGrid(opts: {
  userId: string;
  viewer: Viewer;
  cursor?: string;
  limit?: number;
}): Promise<{ items: GridItem[]; nextCursor: string | null; total: number }> {
  const { userId, viewer, limit = GRID_PAGE_SIZE } = opts;
  const cursor = decodeCursor(opts.cursor);
  const db = getDb();
  const visible = and(
    eq(reviews.authorId, userId),
    eq(reviews.status, "published"),
    isNull(reviews.deletedAt),
    authorVisibleTo(viewer, users),
  );

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: reviews.id,
        slug: reviews.slug,
        rating: reviews.rating,
        hasBody: sql<boolean>`${reviews.body} <> ''`,
        publishedAt: reviews.publishedAt,
        album: { mbid: albums.mbid, title: albums.title, coverKey: albums.coverKey },
        artistName: artists.name,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .innerJoin(artists, eq(albums.artistId, artists.id))
      .where(
        and(
          visible,
          cursor
            ? sql`(${reviews.publishedAt}, ${reviews.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(reviews.publishedAt), desc(reviews.id))
      .limit(limit + 1),
    db
      .select({ n: count() })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .where(visible),
  ]);

  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null,
    total: totalRow.n,
  };
}

// --- Image URLs ----------------------------------------------------------------------------

/** `users.image` is either a full URL (Google picture) or one of our storage keys. */
export function avatarUrl(image: string | null): string | null {
  if (!image) return null;
  return /^https?:\/\//.test(image) ? image : storagePublicUrl(image);
}

export function bannerUrl(key: string | null, size: "full" | "small" = "full"): string | null {
  if (!key) return null;
  return storagePublicUrl(size === "small" ? bannerSmallKey(key) : key);
}
