import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { coverStorageKey, getMusic, type MusicServices } from "@/lib/music";
import { getStorage, type Storage } from "@/lib/storage/r2";
import { queueLinkResolution } from "./links";

const { albums, tracks } = schema;

export type EnrichDeps = { music: MusicServices; storage: Storage | null };

/**
 * Fills in everything about an album that needs slower external calls: tracklist, genres and
 * the cover (copied into our own storage so pages never depend on a third party).
 * Idempotent: safe to retry, and a missing cover or tracklist doesn't fail the job.
 */
export async function enrichAlbum(
  albumId: string,
  deps: EnrichDeps = { music: getMusic(), storage: getStorage() },
): Promise<void> {
  const db = getDb();
  const [album] = await db.select().from(albums).where(eq(albums.id, albumId)).limit(1);
  if (!album) return; // deleted since the job was queued

  const { catalog, covers } = deps.music;
  const details = await catalog.getAlbum(album.mbid);
  const trackList = await catalog.getTracks(album.mbid);

  let coverKey = album.coverKey;
  if (!coverKey && deps.storage) {
    const cover = await covers.fetchFrontCover(album.mbid);
    if (cover) {
      const key = coverStorageKey(album.mbid);
      await deps.storage.put({ key, body: cover.bytes, contentType: cover.contentType });
      coverKey = key;
    }
  }

  await db.transaction(async (tx) => {
    if (trackList.length > 0) {
      await tx
        .insert(tracks)
        .values(trackList.map((t) => ({ albumId, ...t })))
        // Keep rows that already exist so their resolved preview URLs aren't wiped.
        .onConflictDoNothing({ target: [tracks.albumId, tracks.position] });
    }
    await tx
      .update(albums)
      .set({
        genres: details?.genres ?? album.genres,
        releaseDate: details?.releaseDate ?? album.releaseDate,
        primaryType: details?.primaryType ?? album.primaryType,
        coverKey,
        enrichedAt: new Date(),
      })
      .where(eq(albums.id, albumId));
  });
  // Streaming-service links are a separate job: Odesli is slow and tightly rate limited.
  await queueLinkResolution(albumId);
}
