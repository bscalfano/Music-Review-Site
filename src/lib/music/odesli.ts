import { z } from "zod";
import { requestJson, type FetchLike, type Sleep, type Throttle } from "./http";
import { pickBestMatch } from "./preview";
import type { PlatformLinks, PlatformLinksProvider } from "./types";

type Deps = { fetchImpl?: FetchLike; throttle?: Throttle; sleep?: Sleep };
type OdesliDeps = Deps & { apiKey?: string };

// --- Finding a starting URL -----------------------------------------------------------------

const deezerAlbumSchema = z.object({
  data: z.array(
    z.object({
      title: z.string(),
      link: z.string().optional(),
      artist: z.object({ name: z.string() }),
    }),
  ),
});

/**
 * Odesli translates between streaming services but needs one link to start from. Deezer's search
 * is free and keyless, so we find the album there. Returns null when nothing convincingly matches
 * (a wrong album's links would be worse than none).
 */
export async function findAlbumSourceUrl(
  album: { artist: string; title: string },
  deps: Deps = {},
): Promise<string | null> {
  const qs = new URLSearchParams({ q: `${album.artist} ${album.title}`, limit: "10" });
  const json = await requestJson(`https://api.deezer.com/search/album?${qs}`, deps);
  const parsed = deezerAlbumSchema.safeParse(json);
  if (!parsed.success) return null;
  const match = pickBestMatch(
    { artist: album.artist, title: album.title },
    parsed.data.data.map((d) => ({
      title: d.title,
      artist: d.artist.name,
      url: d.link ?? "",
    })),
  );
  return match?.url || null;
}

// --- Odesli ---------------------------------------------------------------------------------

const odesliSchema = z.object({
  linksByPlatform: z.record(
    z.string(),
    z.object({ entityUniqueId: z.string().optional(), url: z.string().optional() }),
  ),
});

/** "SPOTIFY_ALBUM::4LH4d3cOWNNsVw41Gqt2kv" -> the id after the separator. */
function idOf(entityUniqueId: string | undefined): string | undefined {
  const id = entityUniqueId?.split("::")[1];
  return id && /^[\w.-]+$/.test(id) ? id : undefined;
}

/** Pure: turns an Odesli response into the ids we store. */
export function parseOdesliLinks(json: unknown): PlatformLinks | null {
  const parsed = odesliSchema.safeParse(json);
  if (!parsed.success) return null;
  const by = parsed.data.linksByPlatform;
  const links: PlatformLinks = {
    spotifyId: idOf(by.spotify?.entityUniqueId),
    appleMusicId: idOf(by.appleMusic?.entityUniqueId),
    deezerId: idOf(by.deezer?.entityUniqueId),
    youtubeMusicId: idOf(by.youtubeMusic?.entityUniqueId),
    tidalId: idOf(by.tidal?.entityUniqueId),
  };
  return Object.values(links).some(Boolean) ? links : null;
}

/**
 * Odesli / song.link. When last tried it answered 401 to keyless requests, so an API key
 * (ODESLI_API_KEY) is optional input: without it, callers fall back to the direct lookups
 * below and simply get fewer services.
 */
export function createOdesliProvider(deps: OdesliDeps = {}): PlatformLinksProvider {
  const { apiKey, ...http } = deps;
  return {
    async getPlatformLinks({ url }) {
      const qs = new URLSearchParams({ url, userCountry: "US" });
      if (apiKey) qs.set("key", apiKey);
      const json = await requestJson(`https://api.song.link/v1-alpha.1/links?${qs}`, {
        ...http,
        retries: 1,
      });
      return parseOdesliLinks(json);
    },
  };
}

/** "https://www.deezer.com/album/14880741" -> "14880741". */
export function deezerIdFromUrl(url: string): string | undefined {
  return /deezer\.com\/(?:[a-z]{2}\/)?album\/(\d+)/.exec(url)?.[1];
}

const itunesAlbumSchema = z.object({
  results: z.array(
    z.object({
      collectionId: z.number().optional(),
      collectionName: z.string().optional(),
      artistName: z.string().optional(),
    }),
  ),
});

/** Apple Music's album id via the free iTunes Search API (null when no convincing match). */
export async function findAppleMusicAlbumId(
  album: { artist: string; title: string },
  deps: Deps = {},
): Promise<string | null> {
  const qs = new URLSearchParams({
    term: `${album.artist} ${album.title}`,
    entity: "album",
    limit: "10",
  });
  const json = await requestJson(`https://itunes.apple.com/search?${qs}`, deps);
  const parsed = itunesAlbumSchema.safeParse(json);
  if (!parsed.success) return null;
  const match = pickBestMatch(
    { artist: album.artist, title: album.title },
    parsed.data.results.flatMap((r) =>
      r.collectionId && r.collectionName && r.artistName
        ? [{ title: r.collectionName, artist: r.artistName, url: String(r.collectionId) }]
        : [],
    ),
  );
  return match?.url ?? null;
}

// --- URLs for display -----------------------------------------------------------------------

export type PlatformKey = "spotify" | "appleMusic" | "deezer" | "youtubeMusic" | "tidal";

export const PLATFORM_LABELS: Record<PlatformKey, string> = {
  spotify: "Spotify",
  appleMusic: "Apple Music",
  deezer: "Deezer",
  youtubeMusic: "YouTube Music",
  tidal: "Tidal",
};

type StoredIds = {
  spotifyId?: string | null;
  appleMusicId?: string | null;
  deezerId?: string | null;
  youtubeMusicId?: string | null;
  tidalId?: string | null;
};

/** Public album URLs for the services we have ids for. Ids are validated again at link time. */
export function platformUrls(ids: StoredIds): { key: PlatformKey; label: string; url: string }[] {
  const safe = (v: string | null | undefined) => (v && /^[\w.-]+$/.test(v) ? v : null);
  const out: { key: PlatformKey; url: string }[] = [];
  const spotify = safe(ids.spotifyId);
  if (spotify) out.push({ key: "spotify", url: `https://open.spotify.com/album/${spotify}` });
  const apple = safe(ids.appleMusicId);
  if (apple) out.push({ key: "appleMusic", url: `https://music.apple.com/us/album/${apple}` });
  const deezer = safe(ids.deezerId);
  if (deezer) out.push({ key: "deezer", url: `https://www.deezer.com/album/${deezer}` });
  const yt = safe(ids.youtubeMusicId);
  if (yt) out.push({ key: "youtubeMusic", url: `https://music.youtube.com/playlist?list=${yt}` });
  const tidal = safe(ids.tidalId);
  if (tidal) out.push({ key: "tidal", url: `https://tidal.com/album/${tidal}` });
  return out.map((o) => ({ ...o, label: PLATFORM_LABELS[o.key] }));
}
