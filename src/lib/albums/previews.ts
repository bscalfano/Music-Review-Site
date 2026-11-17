import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { findPreview, getMusic, isPreviewFresh, type PreviewProvider } from "@/lib/music";

const { tracks, albums, artists } = schema;

/** A track with no clip anywhere is not searched for again for this long. */
const NOT_FOUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** `force` (the browser couldn't play the stored URL) is honoured at most this often per track. */
const FORCE_RETRY_MS = 60 * 1000;

/**
 * The playable 30-second clip URL for a track, or null if none exists. Stored URLs are reused
 * while they are still valid; Deezer's expire within hours, so they're re-resolved on demand.
 * `force` re-resolves even when the URL looks fresh (used after a playback error).
 */
export async function resolveTrackPreview(
  trackId: string,
  opts: { force?: boolean; previews?: PreviewProvider[]; now?: Date } = {},
): Promise<string | null> {
  const { force = false, now = new Date() } = opts;
  const db = getDb();
  const [row] = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      previewUrl: tracks.previewUrl,
      previewCheckedAt: tracks.previewCheckedAt,
      albumTitle: albums.title,
      artistName: artists.name,
    })
    .from(tracks)
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .where(eq(tracks.id, trackId))
    .limit(1);
  if (!row) return null;

  const checkedAgo = row.previewCheckedAt ? now.getTime() - row.previewCheckedAt.getTime() : null;
  if (force) {
    if (checkedAgo !== null && checkedAgo < FORCE_RETRY_MS) return row.previewUrl;
  } else {
    if (isPreviewFresh(row, now)) return row.previewUrl;
    if (!row.previewUrl && checkedAgo !== null && checkedAgo < NOT_FOUND_RETRY_MS) return null;
  }

  const hit = await findPreview(opts.previews ?? getMusic().previews, {
    artist: row.artistName,
    title: row.title,
    album: row.albumTitle,
  });
  await db
    .update(tracks)
    .set({
      previewUrl: hit?.url ?? null,
      previewSource: hit?.source ?? null,
      previewCheckedAt: now,
    })
    .where(eq(tracks.id, trackId));
  return hit?.url ?? null;
}

/** Whether a stored URL can be handed to the browser as-is (no lookup needed). */
export function usablePreviewUrl(track: {
  previewUrl: string | null;
  previewCheckedAt: Date | null;
}): string | null {
  return isPreviewFresh(track) ? track.previewUrl : null;
}
