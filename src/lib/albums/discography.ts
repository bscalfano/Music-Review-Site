import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DbLike } from "@/db/types";
import { enqueue } from "@/lib/jobs/queue";
import { getMusic } from "@/lib/music";
import type { AlbumCatalogProvider } from "@/lib/music";
import { slugify } from "@/lib/slug";

const { artists, albums, albumStats } = schema;

/** MusicBrainz returns at most 100 release groups per request. */
export const DISCOGRAPHY_PAGE_SIZE = 100;

/**
 * Asks for an artist's whole MusicBrainz discography to be copied into our library, unless that
 * has already been done. Safe to call as often as you like (once per published review): the job
 * is de-duplicated and the artist is marked when the last page is in.
 */
export async function queueDiscographyImport(db: DbLike, artistId: string): Promise<void> {
  const [artist] = await db
    .select({ done: artists.discographyImportedAt })
    .from(artists)
    .where(eq(artists.id, artistId))
    .limit(1);
  if (!artist || artist.done) return;
  await enqueue(
    "import_discography",
    { artistId, offset: 0 },
    { dedupeKey: `import_discography:${artistId}:0`, db },
  );
}

/**
 * Copies one page of the artist's MusicBrainz release groups into `albums`, then queues the next
 * page (or marks the artist finished). One page per job keeps each job short and lets a slow or
 * rate-limited MusicBrainz be retried page by page. Only basic details are stored here; tracks,
 * genres and the cover are filled in later, when an album is first opened or used. Idempotent.
 */
export async function importDiscographyPage(
  artistId: string,
  offset: number,
  deps: { catalog?: AlbumCatalogProvider } = {},
): Promise<void> {
  const db = getDb();
  const [artist] = await db
    .select({ id: artists.id, mbid: artists.mbid, done: artists.discographyImportedAt })
    .from(artists)
    .where(eq(artists.id, artistId))
    .limit(1);
  if (!artist || artist.done) return;

  const page = await (deps.catalog ?? getMusic().catalog).getDiscography(artist.mbid, {
    offset,
    limit: DISCOGRAPHY_PAGE_SIZE,
  });

  if (page.items.length > 0) {
    const rows = await db
      .insert(albums)
      .values(
        page.items.map((a) => ({
          mbid: a.mbid,
          title: a.title,
          slug: slugify(a.title),
          artistId: artist.id,
          releaseDate: a.releaseDate,
          primaryType: a.primaryType,
          secondaryTypes: a.secondaryTypes,
        })),
      )
      // Albums we already have keep their artist, cover and ratings; just fill in the types.
      .onConflictDoUpdate({
        target: albums.mbid,
        set: {
          primaryType: sql`excluded.primary_type`,
          secondaryTypes: sql`excluded.secondary_types`,
        },
      })
      .returning({ id: albums.id });
    await db
      .insert(albumStats)
      .values(rows.map((r) => ({ albumId: r.id })))
      .onConflictDoNothing();
  }

  const next = offset + page.items.length;
  if (page.items.length > 0 && next < page.total) {
    await enqueue(
      "import_discography",
      { artistId, offset: next },
      { dedupeKey: `import_discography:${artistId}:${next}` },
    );
  } else {
    await db
      .update(artists)
      .set({ discographyImportedAt: new Date() })
      .where(and(eq(artists.id, artistId), isNull(artists.discographyImportedAt)));
  }
}
