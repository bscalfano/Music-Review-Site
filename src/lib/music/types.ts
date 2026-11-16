/** Provider-agnostic shapes. Providers translate external APIs into these. */

export type ArtistRef = {
  /** MusicBrainz artist ID. */
  mbid: string;
  name: string;
  sortName: string | null;
};

export type AlbumSearchResult = {
  /** MusicBrainz release-group ID. */
  mbid: string;
  title: string;
  artist: ArtistRef;
  /** Partial dates are normal: "1997", "1997-05", "1997-05-21". */
  releaseDate: string | null;
  primaryType: string | null;
  secondaryTypes: string[];
};

export type AlbumDetails = AlbumSearchResult & {
  genres: string[];
};

export type TrackInfo = {
  /** MusicBrainz recording ID. */
  mbid: string | null;
  title: string;
  /** Overall position across all discs, starting at 1. */
  position: number;
  discNumber: number;
  durationMs: number | null;
};

export type PreviewResult = {
  url: string;
  source: "deezer" | "itunes";
  /** When the URL stops working, if the provider says (Deezer URLs are signed and expire). */
  expiresAt: Date | null;
};

export type PreviewQuery = { artist: string; title: string; album?: string | null };

export type CoverImage = { bytes: Uint8Array; contentType: string };

export interface AlbumCatalogProvider {
  searchAlbums(query: string, opts?: { limit?: number }): Promise<AlbumSearchResult[]>;
  getAlbum(mbid: string): Promise<AlbumDetails | null>;
  getTracks(mbid: string): Promise<TrackInfo[]>;
}

export interface PreviewProvider {
  readonly name: PreviewResult["source"];
  findPreview(query: PreviewQuery): Promise<PreviewResult | null>;
}

export interface CoverProvider {
  fetchFrontCover(mbid: string, opts?: { size?: 250 | 500 | 1200 }): Promise<CoverImage | null>;
}

/** Implemented in Phase 7 (S13, Odesli/song.link). Declared now so callers can depend on it. */
export type PlatformLinks = {
  spotifyId?: string;
  appleMusicId?: string;
  deezerId?: string;
  youtubeMusicId?: string;
  tidalId?: string;
};
export interface PlatformLinksProvider {
  getPlatformLinks(input: { url: string }): Promise<PlatformLinks | null>;
}
