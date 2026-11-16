import { describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "@/lib/music/cache";
import {
  buildSearchQuery,
  createMusicBrainzProvider,
  escapeLucene,
  MusicBrainzParseError,
  parseReleaseGroup,
  parseSearch,
  parseTracks,
  pickReleaseId,
} from "@/lib/music/musicbrainz";
import { fakeFetch, fixture, json, recordingSleep } from "../helpers";

const KID_A = "e75c0549-ad55-39e3-8025-c72c5d4a3c5d";
const RADIOHEAD = "a74b1b7f-71a5-4011-9441-d0b5e4122711";
const UA = "Distortion-test/0.0 ( test )";

describe("parsing", () => {
  it("parses release-group search results", () => {
    const results = parseSearch(fixture("mb-search.json"));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      mbid: KID_A,
      title: "Kid A",
      releaseDate: "2000-08-03",
      primaryType: "Album",
      artist: { mbid: RADIOHEAD, name: "Radiohead" },
    });
  });

  it("parses a release group with genres sorted by popularity", () => {
    const { details } = parseReleaseGroup(fixture("mb-release-group.json"));
    expect(details.title).toBe("Kid A");
    expect(details.genres.length).toBeGreaterThan(0);
    expect(details.genres.length).toBeLessThanOrEqual(8);
    expect(details.genres.every((g) => g === g.toLowerCase())).toBe(true);
  });

  it("picks the earliest official release for the tracklist", () => {
    const { raw } = parseReleaseGroup(fixture("mb-release-group.json"));
    const id = pickReleaseId(raw);
    const chosen = raw.releases!.find((r) => r.id === id)!;
    expect(chosen.status).toBe("Official");
    const officialDates = raw
      .releases!.filter((r) => r.status === "Official" && r.date)
      .map((r) => r.date!);
    expect(chosen.date).toBe(officialDates.sort()[0]);
  });

  it("returns null when there are no releases", () => {
    const { raw } = parseReleaseGroup({
      ...fixture<object>("mb-release-group.json"),
      releases: [],
    });
    expect(pickReleaseId(raw)).toBeNull();
  });

  it("parses a tracklist with continuous positions", () => {
    const tracks = parseTracks(fixture("mb-release.json"));
    expect(tracks).toHaveLength(10);
    expect(tracks[0]).toMatchObject({
      title: "Everything in Its Right Place",
      position: 1,
      discNumber: 1,
      durationMs: 251426,
      mbid: "60bd9d53-01ff-4562-8058-eb44b3940317",
    });
    expect(tracks.map((t) => t.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("numbers tracks continuously across discs", () => {
    const two = {
      media: [
        { position: 1, tracks: [{ title: "a" }, { title: "b" }] },
        { position: 2, tracks: [{ title: "c" }] },
      ],
    };
    expect(parseTracks(two).map((t) => [t.discNumber, t.position])).toEqual([
      [1, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("throws a clear error on an unexpected response", () => {
    expect(() => parseSearch({ error: "nope" })).toThrow(MusicBrainzParseError);
  });

  it("escapes Lucene special characters", () => {
    expect(escapeLucene('AC/DC: "Back in Black" (1980)')).toBe(
      'AC\\/DC\\: \\"Back in Black\\" \\(1980\\)',
    );
  });
});

describe("provider", () => {
  const routes = () =>
    fakeFetch([
      ["/release-group?", () => json(fixture("mb-search.json"))],
      [`/release-group/${KID_A}`, () => json(fixture("mb-release-group.json"))],
      [/\/release\/[0-9a-f-]{36}\?/, () => json(fixture("mb-release.json"))],
    ]);

  it("searches, sending the User-Agent and a Lucene query", async () => {
    const { fetch, calls } = routes();
    const mb = createMusicBrainzProvider({ userAgent: UA, fetchImpl: fetch });
    const results = await mb.searchAlbums("Kid A", { limit: 5 });
    expect(results[0].title).toBe("Kid A");
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init?.headers).get("user-agent")).toBe(UA);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("fmt")).toBe("json");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("query")).toBe(
      "(releasegroup:Kid OR artist:Kid) AND (releasegroup:A OR artist:A) AND (primarytype:album OR primarytype:ep)",
    );
  });

  it("requires every typed word to match the title or the artist", () => {
    expect(buildSearchQuery("radiohead kid a")).toContain(
      "(releasegroup:radiohead OR artist:radiohead) AND",
    );
    expect(buildSearchQuery('AC/DC "x"')).toContain("releasegroup:AC\\/DC");
    expect(buildSearchQuery("  ")).toBeNull();
  });

  it("returns nothing for an empty query without calling the API", async () => {
    const { fetch, calls } = routes();
    const mb = createMusicBrainzProvider({ userAgent: UA, fetchImpl: fetch });
    expect(await mb.searchAlbums("   ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("gets album details and tracks with two lookups total (release group is shared)", async () => {
    const { fetch, calls } = routes();
    const mb = createMusicBrainzProvider({
      userAgent: UA,
      fetchImpl: fetch,
      cache: createMemoryCache(),
    });
    const album = await mb.getAlbum(KID_A);
    const tracks = await mb.getTracks(KID_A);
    expect(album?.artist.name).toBe("Radiohead");
    expect(tracks).toHaveLength(10);
    // 1 release-group lookup (cached for getTracks) + 1 release lookup
    expect(calls).toHaveLength(2);
  });

  it("caches search results", async () => {
    const { fetch, calls } = routes();
    const mb = createMusicBrainzProvider({
      userAgent: UA,
      fetchImpl: fetch,
      cache: createMemoryCache(),
    });
    await mb.searchAlbums("Kid A");
    await mb.searchAlbums("Kid A");
    expect(calls).toHaveLength(1);
  });

  it("calls the throttle before every request, including retries", async () => {
    let n = 0;
    const { fetch } = fakeFetch([
      [
        "/release-group?",
        () => (n++ === 0 ? json({ error: "busy" }, 503) : json(fixture("mb-search.json"))),
      ],
    ]);
    const throttle = vi.fn(async () => {});
    const { sleep } = recordingSleep();
    const mb = createMusicBrainzProvider({ userAgent: UA, fetchImpl: fetch, throttle, sleep });
    await mb.searchAlbums("Kid A");
    expect(throttle).toHaveBeenCalledTimes(2);
  });

  it("retries 'server busy' (503) with backoff, then succeeds", async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch([
      [
        "/release-group?",
        () => (n++ < 2 ? json({ error: "busy" }, 503) : json(fixture("mb-search.json"))),
      ],
    ]);
    const { sleep, delays } = recordingSleep();
    const mb = createMusicBrainzProvider({ userAgent: UA, fetchImpl: fetch, sleep });
    const results = await mb.searchAlbums("Kid A");
    expect(results).not.toHaveLength(0);
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it("gives up after the retry budget", async () => {
    const { fetch, calls } = fakeFetch([["/release-group?", () => json({}, 503)]]);
    const { sleep } = recordingSleep();
    const mb = createMusicBrainzProvider({ userAgent: UA, fetchImpl: fetch, sleep, retries: 3 });
    await expect(mb.searchAlbums("x")).rejects.toThrow(/503/);
    expect(calls).toHaveLength(4); // 1 attempt + 3 retries
  });

  it("returns null / empty for an unknown release group (404)", async () => {
    const { fetch } = fakeFetch([["/release-group/", () => json({ error: "Not Found" }, 404)]]);
    const mb = createMusicBrainzProvider({ userAgent: UA, fetchImpl: fetch });
    expect(await mb.getAlbum(KID_A)).toBeNull();
    expect(await mb.getTracks(KID_A)).toEqual([]);
  });
});
