import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DbLike } from "@/db/types";
import { enqueue } from "@/lib/jobs/queue";
import { getMusic } from "@/lib/music";
import type { AlbumCatalogProvider, ArtistRef } from "@/lib/music";
import { slugify } from "@/lib/slug";

const { artists, albums, albumStats } = schema;

export type AlbumRow = typeof albums.$inferSelect;

/** Finds or creates the artist row. Slugs are unique, so a clash gets the MBID prefix appended. */
async function upsertArtist(db: DbLike, artist: ArtistRef): Promise<string> {
  const [existing] = await db
    .select({ id: artists.id })
    .from(artists)
    .where(eq(artists.mbid, artist.mbid))
    .limit(1);
  if (existing) return existing.id;

  const base = slugify(artist.name);
  const [clash] = await db
    .select({ id: artists.id })
    .from(artists)
    .where(eq(artists.slug, base))
    .limit(1);
  const slug = clash ? `${base}-${artist.mbid.slice(0, 8)}` : base;

  const [row] = await db
    .insert(artists)
    .values({ mbid: artist.mbid, name: artist.name, sortName: artist.sortName, slug })
    .onConflictDoUpdate({ target: artists.mbid, set: { name: artist.name } })
    .returning({ id: artists.id });
  return row.id;
}

/**
 * Returns our row for a MusicBrainz release group, creating it if this is the first time anyone
 * has used the album. Creation is fast (one MusicBrainz lookup); tracklist, genres and cover
 * are filled in later by the `enrich_album` job. Returns null if MusicBrainz doesn't know it.
 */
export async function ensureAlbum(
  mbid: string,
  deps: { catalog?: AlbumCatalogProvider } = {},
): Promise<AlbumRow | null> {
  const db = getDb();
  const [existing] = await db.select().from(albums).where(eq(albums.mbid, mbid)).limit(1);
  if (existing) return existing;

  const details = await (deps.catalog ?? getMusic().catalog).getAlbum(mbid);
  if (!details) return null;

  return db.transaction(async (tx) => {
    const artistId = await upsertArtist(tx, details.artist);
    const [inserted] = await tx
      .insert(albums)
      .values({
        mbid: details.mbid,
        title: details.title,
        slug: slugify(details.title),
        artistId,
        releaseDate: details.releaseDate,
        primaryType: details.primaryType,
        secondaryTypes: details.secondaryTypes,
        genres: details.genres,
      })
      .onConflictDoNothing({ target: albums.mbid })
      .returning();

    // Lost a race with another request that created the same album: use theirs.
    const album =
      inserted ?? (await tx.select().from(albums).where(eq(albums.mbid, mbid)).limit(1))[0];

    await tx.insert(albumStats).values({ albumId: album.id }).onConflictDoNothing();
    if (inserted) {
      await enqueue(
        "enrich_album",
        { albumId: album.id },
        { dedupeKey: `enrich_album:${album.id}`, db: tx },
      );
    }
    return album;
  });
}
