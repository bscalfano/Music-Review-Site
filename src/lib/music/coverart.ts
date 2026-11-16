import { HttpError, requestBytes, type FetchLike, type Sleep, type Throttle } from "./http";
import type { CoverProvider } from "./types";

const BASE_URL = "https://coverartarchive.org";

/** The public Cover Art Archive URL for an album's front cover (used until we've cached our own copy). */
export function coverArtArchiveUrl(mbid: string, size: 250 | 500 | 1200 = 500): string {
  return `${BASE_URL}/release-group/${mbid}/front-${size}`;
}

export function createCoverArtProvider(
  deps: { fetchImpl?: FetchLike; throttle?: Throttle; sleep?: Sleep; userAgent?: string } = {},
): CoverProvider {
  return {
    async fetchFrontCover(mbid, { size = 500 } = {}) {
      try {
        const { bytes, contentType } = await requestBytes(coverArtArchiveUrl(mbid, size), {
          fetchImpl: deps.fetchImpl,
          throttle: deps.throttle,
          sleep: deps.sleep,
          headers: deps.userAgent ? { "User-Agent": deps.userAgent } : undefined,
          timeoutMs: 30_000,
        });
        if (!contentType.startsWith("image/") || bytes.byteLength === 0) return null;
        return { bytes, contentType };
      } catch (err) {
        // 404: the album has no cover art. Not an error.
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      }
    },
  };
}
