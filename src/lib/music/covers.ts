import { readStorageConfig } from "@/lib/storage/r2";
import { coverArtArchiveUrl } from "./coverart";

/**
 * Where to load an album's cover from. Prefers our own cached copy in R2; falls back to the
 * Cover Art Archive until the enrichment job has copied it (or if R2 isn't configured).
 */
export function albumCoverUrl(
  album: { mbid: string; coverKey: string | null },
  size: 250 | 500 | 1200 = 500,
): string {
  const storage = readStorageConfig();
  if (album.coverKey && storage) return `${storage.publicUrl}/${album.coverKey}`;
  return coverArtArchiveUrl(album.mbid, size);
}

export function coverStorageKey(mbid: string): string {
  return `covers/${mbid}.jpg`;
}
