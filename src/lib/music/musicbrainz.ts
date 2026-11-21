import { z } from "zod";
import { cached, DAY_MS, type JsonCache } from "./cache";
import {
  HttpError,
  noThrottle,
  requestJson,
  type FetchLike,
  type Sleep,
  type Throttle,
} from "./http";
import type {
  AlbumCatalogProvider,
  AlbumDetails,
  AlbumSearchResult,
  ArtistRef,
  DiscographyPage,
  TrackInfo,
} from "./types";

const BASE_URL = "https://musicbrainz.org/ws/2";

// --- Response schemas (only the fields we use; everything else is ignored) -------------------

const artistCreditSchema = z.array(
  z.object({
    name: z.string().optional(),
    artist: z.object({
      id: z.string(),
      name: z.string(),
      "sort-name": z.string().optional(),
    }),
  }),
);

const releaseGroupBase = {
  id: z.string(),
  title: z.string(),
  "primary-type": z.string().nullish(),
  "secondary-types": z.array(z.string()).nullish(),
  "first-release-date": z.string().nullish(),
  "artist-credit": artistCreditSchema.min(1),
};

const searchSchema = z.object({
  "release-groups": z.array(z.object(releaseGroupBase)),
});

const releaseGroupSchema = z.object({
  ...releaseGroupBase,
  genres: z.array(z.object({ name: z.string(), count: z.number().optional() })).nullish(),
  releases: z
    .array(
      z.object({
        id: z.string(),
        status: z.string().nullish(),
        date: z.string().nullish(),
      }),
    )
    .nullish(),
});

const releaseSchema = z.object({
  media: z
    .array(
      z.object({
        position: z.number().optional(),
        tracks: z
          .array(
            z.object({
              position: z.number().optional(),
              title: z.string(),
              length: z.number().nullish(),
              recording: z.object({ id: z.string(), length: z.number().nullish() }).nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
});

type RawReleaseGroup = z.infer<typeof releaseGroupSchema>;

export class MusicBrainzParseError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Unexpected MusicBrainz response for ${what}`, { cause });
    this.name = "MusicBrainzParseError";
  }
}

// --- Pure parsing helpers (exported for tests) ----------------------------------------------

export function escapeLucene(input: string): string {
  return input.replace(/[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g, (m) => `\\${m}`).trim();
}

/**
 * "radiohead kid a" -> every word must appear in the album title or the artist name:
 * (releasegroup:radiohead OR artist:radiohead) AND (releasegroup:kid OR artist:kid) AND ...
 * Restricted to albums and EPs. Returns null for an empty query.
 */
export function buildSearchQuery(query: string): string | null {
  const terms = query.split(/\s+/).map(escapeLucene).filter(Boolean);
  if (terms.length === 0) return null;
  const perTerm = terms.map((t) => `(releasegroup:${t} OR artist:${t})`).join(" AND ");
  return `${perTerm} AND (primarytype:album OR primarytype:ep)`;
}

function toArtist(credit: z.infer<typeof artistCreditSchema>): ArtistRef {
  const { artist } = credit[0];
  return { mbid: artist.id, name: artist.name, sortName: artist["sort-name"] ?? null };
}

function toSearchResult(
  rg: z.infer<typeof searchSchema>["release-groups"][number],
): AlbumSearchResult {
  return {
    mbid: rg.id,
    title: rg.title,
    artist: toArtist(rg["artist-credit"]),
    releaseDate: rg["first-release-date"] || null,
    primaryType: rg["primary-type"] ?? null,
    secondaryTypes: rg["secondary-types"] ?? [],
  };
}

export function parseSearch(json: unknown): AlbumSearchResult[] {
  const parsed = searchSchema.safeParse(json);
  if (!parsed.success) throw new MusicBrainzParseError("release-group search", parsed.error);
  return parsed.data["release-groups"].map(toSearchResult);
}

const browseSchema = z.object({
  "release-group-count": z.number().optional(),
  "release-groups": z.array(z.object(releaseGroupBase)),
});

/** A page of an artist's release groups, every type, newest first. */
export function parseDiscographyPage(json: unknown): DiscographyPage {
  const parsed = browseSchema.safeParse(json);
  if (!parsed.success) throw new MusicBrainzParseError("release-group browse", parsed.error);
  const items = parsed.data["release-groups"]
    .map(toSearchResult)
    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
  return { total: parsed.data["release-group-count"] ?? items.length, items };
}

export function parseReleaseGroup(json: unknown): { details: AlbumDetails; raw: RawReleaseGroup } {
  const parsed = releaseGroupSchema.safeParse(json);
  if (!parsed.success) throw new MusicBrainzParseError("release-group lookup", parsed.error);
  const raw = parsed.data;
  const genres = [...(raw.genres ?? [])]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 8)
    .map((g) => g.name.toLowerCase());
  return { details: { ...toSearchResult(raw), genres }, raw };
}

/**
 * Which release to read the tracklist from: the earliest official release (the "original"
 * edition), falling back to the earliest of any status. Releases without a date sort last.
 */
export function pickReleaseId(raw: RawReleaseGroup): string | null {
  const releases = raw.releases ?? [];
  const byDate = (a: { date?: string | null }, b: { date?: string | null }) =>
    (a.date || "9999").localeCompare(b.date || "9999");
  const official = releases.filter((r) => r.status === "Official").sort(byDate);
  return (official[0] ?? [...releases].sort(byDate)[0])?.id ?? null;
}

export function parseTracks(json: unknown): TrackInfo[] {
  const parsed = releaseSchema.safeParse(json);
  if (!parsed.success) throw new MusicBrainzParseError("release lookup", parsed.error);
  const tracks: TrackInfo[] = [];
  for (const [i, medium] of (parsed.data.media ?? []).entries()) {
    for (const t of medium.tracks ?? []) {
      tracks.push({
        mbid: t.recording?.id ?? null,
        title: t.title,
        position: tracks.length + 1,
        discNumber: medium.position ?? i + 1,
        durationMs: t.length ?? t.recording?.length ?? null,
      });
    }
  }
  return tracks;
}

// --- Provider -------------------------------------------------------------------------------

export type MusicBrainzDeps = {
  /** Required by MusicBrainz: identifies the app + a contact. */
  userAgent: string;
  throttle?: Throttle;
  cache?: JsonCache;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  baseUrl?: string;
  /** Retries after the first attempt. MusicBrainz regularly answers 503 "busy" under load. */
  retries?: number;
};

export function createMusicBrainzProvider(deps: MusicBrainzDeps): AlbumCatalogProvider {
  const {
    userAgent,
    throttle = noThrottle,
    cache,
    fetchImpl,
    sleep,
    baseUrl = BASE_URL,
    retries = 5,
  } = deps;

  const get = <T>(path: string, params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, fmt: "json" });
    return requestJson<T>(`${baseUrl}/${path}?${qs}`, {
      fetchImpl,
      sleep,
      throttle,
      retries,
      headers: { "User-Agent": userAgent },
    });
  };

  /** null when the release group doesn't exist (MusicBrainz answers 404). */
  async function fetchReleaseGroupJson(mbid: string): Promise<unknown | null> {
    try {
      return await cached(cache, `mb:rg:${mbid}`, DAY_MS, () =>
        get(`release-group/${mbid}`, { inc: "artist-credits+releases+genres" }),
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  return {
    async searchAlbums(query, { limit = 10 } = {}) {
      const lucene = buildSearchQuery(query);
      if (!lucene) return [];
      const json = await cached(cache, `mb:search:${lucene.toLowerCase()}:${limit}`, DAY_MS, () =>
        get("release-group", { query: lucene, limit: String(limit) }),
      );
      return parseSearch(json);
    },

    async getAlbum(mbid) {
      const json = await fetchReleaseGroupJson(mbid);
      return json ? parseReleaseGroup(json).details : null;
    },

    async getDiscography(artistMbid, { offset = 0, limit = 100 } = {}) {
      // No `type` filter: this is everything on the artist's MusicBrainz page.
      const json = await cached(
        cache,
        `mb:discography:${artistMbid}:${offset}:${limit}`,
        DAY_MS,
        () =>
          get("release-group", {
            artist: artistMbid,
            inc: "artist-credits",
            limit: String(limit),
            offset: String(offset),
          }),
      );
      return parseDiscographyPage(json);
    },

    async getTracks(mbid) {
      const json = await fetchReleaseGroupJson(mbid);
      if (!json) return [];
      const releaseId = pickReleaseId(parseReleaseGroup(json).raw);
      if (!releaseId) return [];
      const release = await cached(cache, `mb:release:${releaseId}`, DAY_MS, () =>
        get(`release/${releaseId}`, { inc: "recordings" }),
      );
      return parseTracks(release);
    },
  };
}
