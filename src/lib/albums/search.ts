import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getMusic, type AlbumSearchResult } from "@/lib/music";

const { albums, artists } = schema;

export type AlbumHit = AlbumSearchResult & {
  /** True when the album already exists in our database. */
  inLibrary: boolean;
  /** Our row's data, when inLibrary. */
  albumId?: string;
  slug?: string;
  coverKey?: string | null;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Albums we already have, ranked by trigram similarity to the album title and/or artist name. */
export async function searchAlbumsLocal(query: string, limit = 10): Promise<AlbumHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${escapeLike(q)}%`;
  const combined = sql`(${artists.name} || ' ' || ${albums.title})`;
  const score = sql<number>`greatest(
    similarity(${albums.title}, ${q}), similarity(${artists.name}, ${q}), similarity(${combined}, ${q})
  )`;

  const rows = await getDb()
    .select({ album: albums, artist: artists })
    .from(albums)
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .where(
      or(
        ilike(albums.title, like),
        ilike(artists.name, like),
        sql`${albums.title} % ${q}`,
        sql`${artists.name} % ${q}`,
        sql`${combined} % ${q}`,
      ),
    )
    .orderBy(desc(score))
    .limit(limit);

  return rows.map(({ album, artist }) => ({
    mbid: album.mbid,
    title: album.title,
    artist: { mbid: artist.mbid, name: artist.name, sortName: artist.sortName },
    releaseDate: album.releaseDate,
    primaryType: album.primaryType,
    secondaryTypes: [],
    inLibrary: true,
    albumId: album.id,
    slug: album.slug,
    coverKey: album.coverKey,
  }));
}

/**
 * The album picker's search. Looks in our own database first (instant, and it spares
 * MusicBrainz's 1 request/second site-wide limit); MusicBrainz is only asked when `remote` is
 * set (the user clicked "search all of MusicBrainz") or we found nothing locally.
 */
export async function searchAlbums(
  query: string,
  opts: { remote?: boolean; limit?: number } = {},
): Promise<AlbumHit[]> {
  const { remote = false, limit = 10 } = opts;
  const local = await searchAlbumsLocal(query, limit);
  if (!remote && local.length > 0) return local;

  const external = await getMusic().catalog.searchAlbums(query, { limit });
  const known = new Set(local.map((h) => h.mbid));
  const extra = external.filter((r) => !known.has(r.mbid)).map((r) => ({ ...r, inLibrary: false }));
  return [...local, ...extra].slice(0, limit);
}
