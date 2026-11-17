import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { getDb, schema } from "@/db";
import { albumPath } from "@/lib/albums/paths";

// Reads the database, so build it per request (cached by the CDN) rather than at build time.
export const dynamic = "force-dynamic";

const { users, reviews, albums } = schema;
const abs = (path: string) => new URL(path, siteConfig.url).toString();

/**
 * Public pages only. Private, suspended and deleted accounts (and everything they wrote) are
 * left out, as are drafts and taken-down reviews.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = getDb();
  const publicAuthor = and(
    eq(users.isPrivate, false),
    eq(users.status, "active"),
    isNull(users.deletedAt),
    sql`${users.handle} IS NOT NULL`,
  );

  const [profiles, reviewRows, albumRows] = await Promise.all([
    db.select({ handle: users.handle }).from(users).where(publicAuthor).limit(5000),
    db
      .select({
        handle: users.handle,
        slug: reviews.slug,
        updatedAt: reviews.updatedAt,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .where(
        and(
          publicAuthor,
          eq(reviews.status, "published"),
          isNull(reviews.deletedAt),
          sql`${reviews.body} <> ''`,
        ),
      )
      .orderBy(desc(reviews.publishedAt))
      .limit(20000),
    db
      .selectDistinct({ mbid: albums.mbid, slug: albums.slug })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .where(and(publicAuthor, eq(reviews.status, "published"), isNull(reviews.deletedAt)))
      .limit(10000),
  ]);

  return [
    ...["/", "/discover", "/about", "/terms", "/privacy", "/guidelines"].map((p) => ({
      url: abs(p),
    })),
    ...profiles.map((p) => ({ url: abs(`/u/${p.handle}`) })),
    ...reviewRows.map((r) => ({ url: abs(`/u/${r.handle}/${r.slug}`), lastModified: r.updatedAt })),
    ...albumRows.map((a) => ({ url: abs(albumPath(a)) })),
  ];
}
