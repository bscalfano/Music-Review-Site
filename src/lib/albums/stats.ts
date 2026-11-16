import { and, count, eq, isNull } from "drizzle-orm";
import { schema } from "@/db";
import type { DbLike } from "@/db/types";

const { reviews, favoriteAlbums, albumStats } = schema;

export type AlbumStatsValues = {
  ratingCount: number;
  ratingSum: number;
  histogram: number[];
  logCount: number;
  reviewCount: number;
};

/** Pure aggregation over an album's published reviews. Ratings are half-star units (0-10). */
export function aggregateReviews(
  rows: Array<{ rating: number | null; body: string }>,
): AlbumStatsValues {
  const histogram = Array<number>(11).fill(0);
  let ratingCount = 0;
  let ratingSum = 0;
  let reviewCount = 0;
  for (const row of rows) {
    if (row.rating !== null) {
      ratingCount++;
      ratingSum += row.rating;
      histogram[row.rating]++;
    }
    if (row.body.trim() !== "") reviewCount++;
  }
  return { ratingCount, ratingSum, histogram, logCount: rows.length, reviewCount };
}

/**
 * Rebuilds album_stats for one album from source rows. Ratings from private accounts are
 * included on purpose: they count anonymously toward public averages (see PLAN Q7).
 * Call inside the same transaction as the review/favorite write that changed the data.
 */
export async function recomputeAlbumStats(db: DbLike, albumId: string): Promise<void> {
  const rows = await db
    .select({ rating: reviews.rating, body: reviews.body })
    .from(reviews)
    .where(
      and(eq(reviews.albumId, albumId), eq(reviews.status, "published"), isNull(reviews.deletedAt)),
    );
  const [fans] = await db
    .select({ n: count() })
    .from(favoriteAlbums)
    .where(eq(favoriteAlbums.albumId, albumId));

  const values = { ...aggregateReviews(rows), fanCount: fans?.n ?? 0, updatedAt: new Date() };
  await db
    .insert(albumStats)
    .values({ albumId, ...values })
    .onConflictDoUpdate({ target: albumStats.albumId, set: values });
}
