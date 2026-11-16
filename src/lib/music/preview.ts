import { z } from "zod";
import { requestJson, type FetchLike, type Sleep, type Throttle } from "./http";
import type { PreviewProvider, PreviewQuery, PreviewResult } from "./types";

// --- Matching -------------------------------------------------------------------------------

export function normalize(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words that mark a different recording than the one the user means. */
const VARIANT_WORDS =
  /\b(live|remix|karaoke|instrumental|acoustic|demo|cover|tribute|edit|reprise|version)\b/;

export type Candidate = { title: string; artist: string; album?: string | null; url: string };

/**
 * Picks the candidate most likely to be the same recording, or null if none is convincing.
 * Search APIs happily return covers and remixes by other artists first, so we require the
 * artist to match and score the title/album on top of that.
 */
export function pickBestMatch(query: PreviewQuery, candidates: Candidate[]): Candidate | null {
  const wantArtist = normalize(query.artist);
  const wantTitle = normalize(query.title);
  const wantAlbum = query.album ? normalize(query.album) : null;
  if (!wantArtist || !wantTitle) return null;
  const queryHasVariant = VARIANT_WORDS.test(wantTitle);

  let best: { c: Candidate; score: number } | null = null;
  for (const c of candidates) {
    if (!c.url) continue;
    const artist = normalize(c.artist);
    const title = normalize(c.title);
    const artistOk =
      artist === wantArtist || artist.includes(wantArtist) || wantArtist.includes(artist);
    if (!artistOk) continue;

    let score = 0;
    if (title === wantTitle) score += 3;
    else if (title.startsWith(wantTitle) || wantTitle.startsWith(title)) score += 1;
    else continue;

    if (artist === wantArtist) score += 1;
    if (!queryHasVariant && VARIANT_WORDS.test(title)) score -= 3;
    if (wantAlbum && c.album) {
      const album = normalize(c.album);
      if (album === wantAlbum) score += 2;
      else if (album.includes(wantAlbum) || wantAlbum.includes(album)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

// --- Expiry ---------------------------------------------------------------------------------

/** Deezer preview URLs are signed: `...?hdnea=exp=1794864870~acl=...`. Returns that expiry. */
export function previewExpiry(url: string): Date | null {
  const m = /[?&~=]exp=(\d{9,11})/.exec(url) ?? /exp%3D(\d{9,11})/.exec(url);
  return m ? new Date(Number(m[1]) * 1000) : null;
}

/** iTunes preview URLs don't expire; re-check them occasionally anyway. */
const UNSIGNED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** True if a stored preview URL can still be used (with a safety margin for signed URLs). */
export function isPreviewFresh(
  track: { previewUrl: string | null; previewCheckedAt: Date | null },
  now = new Date(),
  marginMs = 10 * 60 * 1000,
): boolean {
  if (!track.previewUrl) return false;
  const expiry = previewExpiry(track.previewUrl);
  if (expiry) return expiry.getTime() - marginMs > now.getTime();
  return (
    !!track.previewCheckedAt &&
    now.getTime() - track.previewCheckedAt.getTime() < UNSIGNED_MAX_AGE_MS
  );
}

// --- Providers ------------------------------------------------------------------------------

type ProviderDeps = { fetchImpl?: FetchLike; throttle?: Throttle; sleep?: Sleep };

const deezerSchema = z.object({
  data: z.array(
    z.object({
      title: z.string(),
      preview: z.string().optional(),
      artist: z.object({ name: z.string() }),
      album: z.object({ title: z.string() }).optional(),
    }),
  ),
});

/** Deezer: free, no key. Its `artist:"x" track:"y"` syntax is unreliable, so use a plain query. */
export function createDeezerProvider(deps: ProviderDeps = {}): PreviewProvider {
  return {
    name: "deezer",
    async findPreview(query) {
      const qs = new URLSearchParams({ q: `${query.artist} ${query.title}`, limit: "10" });
      const json = await requestJson(`https://api.deezer.com/search?${qs}`, deps);
      const parsed = deezerSchema.safeParse(json);
      if (!parsed.success) return null; // Deezer reports errors as {"error": {...}} with HTTP 200
      const match = pickBestMatch(
        query,
        parsed.data.data.map((d) => ({
          title: d.title,
          artist: d.artist.name,
          album: d.album?.title,
          url: d.preview ?? "",
        })),
      );
      return match
        ? { url: match.url, source: "deezer", expiresAt: previewExpiry(match.url) }
        : null;
    },
  };
}

const itunesSchema = z.object({
  results: z.array(
    z.object({
      trackName: z.string().optional(),
      artistName: z.string().optional(),
      collectionName: z.string().optional(),
      previewUrl: z.string().optional(),
    }),
  ),
});

/** iTunes Search API: free, no key, ~20 requests/minute. Used as the fallback. */
export function createItunesProvider(deps: ProviderDeps = {}): PreviewProvider {
  return {
    name: "itunes",
    async findPreview(query) {
      const qs = new URLSearchParams({
        term: `${query.artist} ${query.title}`,
        entity: "song",
        limit: "10",
      });
      const json = await requestJson(`https://itunes.apple.com/search?${qs}`, deps);
      const parsed = itunesSchema.safeParse(json);
      if (!parsed.success) return null;
      const match = pickBestMatch(
        query,
        parsed.data.results.flatMap((r) =>
          r.trackName && r.artistName && r.previewUrl
            ? [
                {
                  title: r.trackName,
                  artist: r.artistName,
                  album: r.collectionName,
                  url: r.previewUrl,
                },
              ]
            : [],
        ),
      );
      return match ? { url: match.url, source: "itunes", expiresAt: null } : null;
    },
  };
}

/** Tries each provider in order; a failing provider is skipped, not fatal. */
export async function findPreview(
  providers: PreviewProvider[],
  query: PreviewQuery,
): Promise<PreviewResult | null> {
  for (const provider of providers) {
    try {
      const hit = await provider.findPreview(query);
      if (hit) return hit;
    } catch {
      // fall through to the next provider
    }
  }
  return null;
}
