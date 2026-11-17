const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /albums/<slug>-<mbid>: the slug is for people, the MusicBrainz ID is the real identity. */
export const albumPath = (album: { slug: string; mbid: string }) =>
  `/albums/${album.slug}-${album.mbid}`;

/** Splits the URL segment back into its parts, or null if it doesn't end in a valid MBID. */
export function parseAlbumSegment(segment: string): { slug: string; mbid: string } | null {
  const decoded = decodeURIComponent(segment);
  const mbid = decoded.slice(-36).toLowerCase();
  if (!MBID.test(mbid) || (decoded.length > 36 && decoded[decoded.length - 37] !== "-"))
    return null;
  return { slug: decoded.slice(0, -37), mbid };
}
