import { describe, expect, it } from "vitest";
import { createCoverArtProvider, coverArtArchiveUrl } from "@/lib/music/coverart";
import {
  createDeezerProvider,
  createItunesProvider,
  findPreview,
  isPreviewFresh,
  normalize,
  pickBestMatch,
  previewExpiry,
} from "@/lib/music/preview";
import type { PreviewProvider } from "@/lib/music/types";
import { fakeFetch, fixture, json } from "../helpers";

const query = { artist: "Radiohead", title: "Everything in Its Right Place", album: "Kid A" };

describe("matching", () => {
  it("normalizes case, accents and punctuation", () => {
    expect(normalize("Beyoncé — Halo (Live!)")).toBe("beyonce halo live");
  });

  it("requires the artist to match", () => {
    const hit = pickBestMatch(query, [
      { title: "Everything In Its Right Place", artist: "Gigamesh", album: "x", url: "https://a" },
    ]);
    expect(hit).toBeNull();
  });

  it("avoids live versions and remixes unless asked for", () => {
    const hit = pickBestMatch(query, [
      {
        title: "Everything In Its Right Place (Live in France)",
        artist: "Radiohead",
        album: "I Might Be Wrong",
        url: "https://live",
      },
      {
        title: "Everything In Its Right Place",
        artist: "Radiohead",
        album: "Kid A",
        url: "https://studio",
      },
    ]);
    expect(hit?.url).toBe("https://studio");
    const live = pickBestMatch(
      { ...query, title: "Everything In Its Right Place (Live in France)" },
      [
        {
          title: "Everything In Its Right Place (Live in France)",
          artist: "Radiohead",
          url: "https://live",
        },
      ],
    );
    expect(live?.url).toBe("https://live");
  });

  it("returns null when nothing is convincing", () => {
    expect(
      pickBestMatch(query, [{ title: "Idioteque", artist: "Radiohead", url: "https://x" }]),
    ).toBeNull();
    expect(pickBestMatch(query, [])).toBeNull();
  });
});

describe("providers", () => {
  it("Deezer: skips the first, wrong-artist result and picks Radiohead's studio track", async () => {
    const { fetch, calls } = fakeFetch([
      ["api.deezer.com/search", () => json(fixture("deezer-search.json"))],
    ]);
    const hit = await createDeezerProvider({ fetchImpl: fetch }).findPreview(query);
    expect(hit?.source).toBe("deezer");
    expect(hit?.url).toContain("dzcdn.net");
    expect(hit?.expiresAt).toBeInstanceOf(Date); // signed URL carries its expiry
    expect(new URL(calls[0].url).searchParams.get("q")).toBe(
      "Radiohead Everything in Its Right Place",
    );
    const raw = fixture<{
      data: Array<{
        artist: { name: string };
        title: string;
        album: { title: string };
        preview: string;
      }>;
    }>("deezer-search.json");
    const radiohead = raw.data.find(
      (d) => d.artist.name === "Radiohead" && d.album.title === "Kid A",
    )!;
    expect(hit?.url).toBe(radiohead.preview);
  });

  it("Deezer: treats an error body as no result", async () => {
    const { fetch } = fakeFetch([
      ["api.deezer.com", () => json({ error: { type: "Exception", code: 4 } })],
    ]);
    expect(await createDeezerProvider({ fetchImpl: fetch }).findPreview(query)).toBeNull();
  });

  it("iTunes: picks the Radiohead track with an unsigned preview", async () => {
    const { fetch } = fakeFetch([
      ["itunes.apple.com/search", () => json(fixture("itunes-search.json"))],
    ]);
    const hit = await createItunesProvider({ fetchImpl: fetch }).findPreview(query);
    expect(hit).toMatchObject({ source: "itunes", expiresAt: null });
    expect(hit?.url).toContain("itunes-assets");
  });

  it("falls back to the next provider when one fails or finds nothing", async () => {
    const failing: PreviewProvider = {
      name: "deezer",
      findPreview: async () => {
        throw new Error("boom");
      },
    };
    const empty: PreviewProvider = { name: "deezer", findPreview: async () => null };
    const good: PreviewProvider = {
      name: "itunes",
      findPreview: async () => ({ url: "https://ok", source: "itunes", expiresAt: null }),
    };
    expect((await findPreview([failing, empty, good], query))?.url).toBe("https://ok");
    expect(await findPreview([failing, empty], query)).toBeNull();
  });
});

describe("preview expiry", () => {
  const url =
    "https://cdnt-preview.dzcdn.net/api/x.mp3?hdnea=exp=1794864870~acl=/api/x.mp3*~hmac=abc";

  it("reads the expiry from a signed Deezer URL", () => {
    expect(previewExpiry(url)?.getTime()).toBe(1794864870 * 1000);
    expect(previewExpiry("https://itunes/preview.m4a")).toBeNull();
  });

  it("treats signed URLs as stale shortly before they expire", () => {
    const expiry = previewExpiry(url)!.getTime();
    const track = { previewUrl: url, previewCheckedAt: new Date(expiry - 3_600_000) };
    expect(isPreviewFresh(track, new Date(expiry - 3_600_000))).toBe(true);
    expect(isPreviewFresh(track, new Date(expiry - 60_000))).toBe(false); // inside the 10 min margin
    expect(isPreviewFresh(track, new Date(expiry + 1))).toBe(false);
  });

  it("re-checks unsigned URLs after 30 days and treats missing ones as stale", () => {
    const checked = new Date("2026-01-01T00:00:00Z");
    const track = { previewUrl: "https://itunes/p.m4a", previewCheckedAt: checked };
    expect(isPreviewFresh(track, new Date("2026-01-20T00:00:00Z"))).toBe(true);
    expect(isPreviewFresh(track, new Date("2026-03-01T00:00:00Z"))).toBe(false);
    expect(isPreviewFresh({ previewUrl: null, previewCheckedAt: null })).toBe(false);
  });
});

describe("Cover Art Archive", () => {
  const mbid = "e75c0549-ad55-39e3-8025-c72c5d4a3c5d";

  it("builds the front-cover URL", () => {
    expect(coverArtArchiveUrl(mbid)).toBe(
      `https://coverartarchive.org/release-group/${mbid}/front-500`,
    );
  });

  it("returns image bytes", async () => {
    const { fetch } = fakeFetch([
      [
        "coverartarchive.org",
        () =>
          new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
      ],
    ]);
    const cover = await createCoverArtProvider({ fetchImpl: fetch }).fetchFrontCover(mbid);
    expect(cover?.contentType).toBe("image/jpeg");
    expect(Array.from(cover!.bytes)).toEqual([1, 2, 3]);
  });

  it("returns null when the album has no cover (404) and rejects non-images", async () => {
    const missing = fakeFetch([
      ["coverartarchive.org", () => new Response("not found", { status: 404 })],
    ]);
    expect(
      await createCoverArtProvider({ fetchImpl: missing.fetch }).fetchFrontCover(mbid),
    ).toBeNull();
    const html = fakeFetch([
      [
        "coverartarchive.org",
        () => new Response("<html>", { headers: { "content-type": "text/html" } }),
      ],
    ]);
    expect(
      await createCoverArtProvider({ fetchImpl: html.fetch }).fetchFrontCover(mbid),
    ).toBeNull();
  });
});
