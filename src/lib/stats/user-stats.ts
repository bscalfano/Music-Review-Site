import { and, count, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { authorVisibleTo, type Viewer } from "@/lib/social/visibility";

const { reviews, albums, artists, users } = schema;

export type UserStats = {
  total: number;
  rated: number;
  /** Mean rating in stars (0-5), or null with no ratings. */
  average: number | null;
  /** Index = half-star units 0..10 (so index 7 = 3.5 stars): how many reviews have that rating. */
  distribution: number[];
  perYear: { year: number; count: number }[];
  topArtists: { name: string; slug: string; count: number; average: number | null }[];
  /** Albums grouped by the decade they were released in (rated ones only). */
  byDecade: { decade: number; count: number; average: number }[];
};

/** Pure: turns grouped rating counts into the 11-bucket distribution. */
export function toDistribution(rows: { rating: number; n: number }[]): number[] {
  const out = Array<number>(11).fill(0);
  for (const r of rows) if (r.rating >= 0 && r.rating <= 10) out[r.rating] += r.n;
  return out;
}

/** Pure: half-star units to stars, one decimal. */
export const toStars = (halfStars: number | null) =>
  halfStars === null ? null : Math.round(halfStars * 5) / 10;

/**
 * S10: numbers for the profile Stats tab, from the reviews and logs `viewer` can see. Counts every
 * published review and log of that person, so it never reveals more than their grid already does.
 */
export async function getUserStats(userId: string, viewer: Viewer): Promise<UserStats> {
  const db = getDb();
  const visible = and(
    eq(reviews.authorId, userId),
    eq(reviews.status, "published"),
    isNull(reviews.deletedAt),
    authorVisibleTo(viewer, users),
  );
  const [[totals], dist, perYear, topArtists, byDecade] = await Promise.all([
    db
      .select({
        total: count(),
        rated: sql<number>`count(${reviews.rating})::int`,
        avg: sql<number | null>`avg(${reviews.rating})::float`,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .where(visible),
    db
      .select({ rating: reviews.rating, n: count() })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .where(and(visible, isNotNull(reviews.rating)))
      .groupBy(reviews.rating),
    db
      .select({
        year: sql<number>`extract(year from ${reviews.publishedAt})::int`,
        n: count(),
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .where(and(visible, isNotNull(reviews.publishedAt)))
      .groupBy(sql`extract(year from ${reviews.publishedAt})`)
      .orderBy(sql`extract(year from ${reviews.publishedAt})`),
    db
      .select({
        name: artists.name,
        slug: artists.slug,
        n: count(),
        avg: sql<number | null>`avg(${reviews.rating})::float`,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .innerJoin(artists, eq(albums.artistId, artists.id))
      .where(visible)
      .groupBy(artists.id, artists.name, artists.slug)
      .orderBy(desc(count()), sql`avg(${reviews.rating}) DESC NULLS LAST`, artists.name)
      .limit(10),
    db
      .select({
        decade: sql<number>`(left(${albums.releaseDate}, 4)::int / 10 * 10)`,
        n: count(),
        avg: sql<number>`avg(${reviews.rating})::float`,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .where(and(visible, isNotNull(reviews.rating), sql`${albums.releaseDate} ~ '^[0-9]{4}'`))
      .groupBy(sql`left(${albums.releaseDate}, 4)::int / 10 * 10`)
      .orderBy(sql`left(${albums.releaseDate}, 4)::int / 10 * 10`),
  ]);

  return {
    total: totals.total,
    rated: totals.rated,
    average: toStars(totals.avg),
    distribution: toDistribution(dist.map((d) => ({ rating: d.rating!, n: d.n }))),
    perYear: perYear.map((r) => ({ year: r.year, count: r.n })),
    topArtists: topArtists.map((a) => ({
      name: a.name,
      slug: a.slug,
      count: a.n,
      average: toStars(a.avg),
    })),
    byDecade: byDecade.map((d) => ({
      decade: d.decade,
      count: d.n,
      average: toStars(d.avg)!,
    })),
  };
}
