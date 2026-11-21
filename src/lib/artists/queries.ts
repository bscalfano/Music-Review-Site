import { asc, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/db";
import type { AlbumSearchResult } from "@/lib/music";

const { artists, albums, albumStats } = schema;

export const getArtistBySlug = cache(async (slug: string) => {
  const [row] = await getDb().select().from(artists).where(eq(artists.slug, slug)).limit(1);
  return row ?? null;
});

export type ArtistAlbum = {
  mbid: string;
  slug: string | null;
  title: string;
  releaseDate: string | null;
  primaryType: string | null;
  secondaryTypes: string[];
  coverKey: string | null;
  /** In our database (so it has a page). MusicBrainz-only entries are false. */
  inLibrary: boolean;
  ratingCount: number;
  /** Stars to one decimal, or null when nobody has rated it. */
  average: string | null;
  reviewCount: number;
};

/** Albums of ours by this artist, with community numbers. */
export async function getLibraryAlbums(artistId: string): Promise<ArtistAlbum[]> {
  const rows = await getDb()
    .select({
      mbid: albums.mbid,
      slug: albums.slug,
      title: albums.title,
      releaseDate: albums.releaseDate,
      primaryType: albums.primaryType,
      secondaryTypes: albums.secondaryTypes,
      coverKey: albums.coverKey,
      ratingCount: albumStats.ratingCount,
      ratingSum: albumStats.ratingSum,
      reviewCount: albumStats.reviewCount,
    })
    .from(albums)
    .leftJoin(albumStats, eq(albumStats.albumId, albums.id))
    .where(eq(albums.artistId, artistId))
    .orderBy(desc(albums.releaseDate), asc(albums.title));
  return rows.map((r) => ({
    mbid: r.mbid,
    slug: r.slug,
    title: r.title,
    releaseDate: r.releaseDate,
    primaryType: r.primaryType,
    secondaryTypes: r.secondaryTypes,
    coverKey: r.coverKey,
    inLibrary: true,
    ratingCount: r.ratingCount ?? 0,
    average: r.ratingCount ? (r.ratingSum! / r.ratingCount / 2).toFixed(1) : null,
    reviewCount: r.reviewCount ?? 0,
  }));
}

/**
 * Our albums plus whatever MusicBrainz lists that we don't have yet, newest first. Our own rows
 * win when both have an album (they carry the ratings). MusicBrainz-only entries come last in
 * each year's position by date.
 */
export function mergeDiscography(
  library: ArtistAlbum[],
  discography: AlbumSearchResult[],
): ArtistAlbum[] {
  const have = new Set(library.map((a) => a.mbid));
  const extra: ArtistAlbum[] = discography
    .filter((d) => !have.has(d.mbid))
    .map((d) => ({
      mbid: d.mbid,
      slug: null,
      title: d.title,
      releaseDate: d.releaseDate,
      primaryType: d.primaryType,
      secondaryTypes: d.secondaryTypes,
      coverKey: null,
      inLibrary: false,
      ratingCount: 0,
      average: null,
      reviewCount: 0,
    }));
  return [...library, ...extra].sort(
    (a, b) =>
      (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.title.localeCompare(b.title),
  );
}
