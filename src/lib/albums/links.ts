import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  deezerIdFromUrl,
  findAlbumSourceUrl,
  findAppleMusicAlbumId,
  getMusic,
  type MusicServices,
} from "@/lib/music";
import { itunesThrottle } from "@/lib/music/throttle";
import { enqueue } from "@/lib/jobs/queue";

const { albums, artists } = schema;

export type LinkDeps = {
  /** Odesli (Spotify, YouTube Music, Tidal...). Optional: it needs an API key. */
  links?: MusicServices["links"];
  /** A Deezer album URL for the album, the starting point for Odesli and the Deezer id. */
  findSource?: (album: { artist: string; title: string }) => Promise<string | null>;
  /** Apple Music's album id. */
  findApple?: (album: { artist: string; title: string }) => Promise<string | null>;
};

/** What runs in production. Tests pass their own, leaving out whatever they don't exercise. */
function productionDeps(): LinkDeps {
  return {
    links: getMusic().links,
    findSource: (a) => findAlbumSourceUrl(a),
    findApple: (a) => findAppleMusicAlbumId(a, { throttle: itunesThrottle() }),
  };
}

/** Each source is best effort: one being down or unauthorised must not lose the others. */
async function attempt<T>(what: string, fn: (() => Promise<T>) | undefined): Promise<T | null> {
  if (!fn) return null;
  try {
    return await fn();
  } catch (err) {
    console.warn(`[links] ${what} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * S13: finds this album's pages on other streaming services and stores their ids on the album.
 * Deezer and Apple Music come from their own free search APIs; Odesli adds the rest when it is
 * available. Runs once per album as a background job. "Nothing found" is a normal answer: it is
 * recorded (`linksResolvedAt`) so we don't keep asking, and an admin can retry with "Fix links".
 */
export async function resolveAlbumLinks(
  albumId: string,
  deps: LinkDeps = productionDeps(),
): Promise<"found" | "none" | "missing"> {
  const db = getDb();
  const [row] = await db
    .select({ title: albums.title, artist: artists.name })
    .from(albums)
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .where(eq(albums.id, albumId))
    .limit(1);
  if (!row) return "missing";

  const source = await attempt("deezer search", deps.findSource && (() => deps.findSource!(row)));
  const appleId = await attempt("apple search", deps.findApple && (() => deps.findApple!(row)));
  const odesli = source
    ? await attempt("odesli", deps.links && (() => deps.links!.getPlatformLinks({ url: source })))
    : null;

  const found = {
    spotifyId: odesli?.spotifyId,
    youtubeMusicId: odesli?.youtubeMusicId,
    tidalId: odesli?.tidalId,
    deezerId: odesli?.deezerId ?? (source ? deezerIdFromUrl(source) : undefined),
    appleMusicId: odesli?.appleMusicId ?? appleId ?? undefined,
  };
  const any = Object.values(found).some(Boolean);

  await db
    .update(albums)
    .set({
      // Keep what we had if a retry finds less; only fill in what we just learned.
      ...(found.spotifyId ? { spotifyId: found.spotifyId } : {}),
      ...(found.appleMusicId ? { appleMusicId: found.appleMusicId } : {}),
      ...(found.deezerId ? { deezerId: found.deezerId } : {}),
      ...(found.youtubeMusicId ? { youtubeMusicId: found.youtubeMusicId } : {}),
      ...(found.tidalId ? { tidalId: found.tidalId } : {}),
      linksResolvedAt: new Date(),
    })
    .where(eq(albums.id, albumId));
  return any ? "found" : "none";
}

/** Queues a lookup (one pending job per album). */
export async function queueLinkResolution(albumId: string): Promise<void> {
  await enqueue("resolve_links", { albumId }, { dedupeKey: `resolve_links:${albumId}` });
}

/** Admin "Fix links": forget what we stored and look again. */
export async function resetAlbumLinks(albumId: string): Promise<void> {
  await getDb()
    .update(albums)
    .set({
      spotifyId: null,
      appleMusicId: null,
      deezerId: null,
      youtubeMusicId: null,
      tidalId: null,
      linksResolvedAt: null,
    })
    .where(eq(albums.id, albumId));
  await queueLinkResolution(albumId);
}
