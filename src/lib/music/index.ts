import { siteConfig } from "@/config/site";
import { createDbCache } from "./cache";
import { createCoverArtProvider } from "./coverart";
import { createMusicBrainzProvider } from "./musicbrainz";
import { createDeezerProvider, createItunesProvider } from "./preview";
import { itunesThrottle, musicBrainzThrottle } from "./throttle";
import type { AlbumCatalogProvider, CoverProvider, PreviewProvider } from "./types";

export * from "./types";
export { albumCoverUrl, coverStorageKey } from "./covers";
export { findPreview, isPreviewFresh, previewExpiry } from "./preview";

/** MusicBrainz requires an identifying User-Agent with a contact (set MUSICBRAINZ_USER_AGENT). */
function userAgent(): string {
  return (
    process.env.MUSICBRAINZ_USER_AGENT || `${siteConfig.name}/0.1 ( set MUSICBRAINZ_USER_AGENT )`
  );
}

export type MusicServices = {
  catalog: AlbumCatalogProvider;
  covers: CoverProvider;
  /** In priority order. */
  previews: PreviewProvider[];
};

let services: MusicServices | undefined;

/** The production wiring: DB-backed throttle + cache. Everything else takes these as parameters. */
export function getMusic(): MusicServices {
  services ??= {
    catalog: createMusicBrainzProvider({
      userAgent: userAgent(),
      throttle: musicBrainzThrottle(),
      cache: createDbCache(),
    }),
    covers: createCoverArtProvider({ userAgent: userAgent() }),
    previews: [createDeezerProvider(), createItunesProvider({ throttle: itunesThrottle() })],
  };
  return services;
}
