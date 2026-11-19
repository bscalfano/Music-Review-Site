/**
 * Phase 7 (discovery): platform links, sort/filter, search and artist pages. Pure parsing tests,
 * plus DB integration tests with throwaway @disc-test.invalid users and random MBIDs
 * (skipped without DATABASE_URL).
 */
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { getArtistReviews } from "@/lib/social/feed";
import { mergeDiscography, getLibraryAlbums, type ArtistAlbum } from "@/lib/artists/queries";
import { resolveAlbumLinks } from "@/lib/albums/links";
import { filtersToQuery, parseFilters } from "@/lib/discovery/filters";
import { createMusicBrainzProvider, parseDiscography } from "@/lib/music/musicbrainz";
import {
  deezerIdFromUrl,
  findAlbumSourceUrl,
  findAppleMusicAlbumId,
  parseOdesliLinks,
  platformUrls,
} from "@/lib/music/odesli";
import { getProfileGrid } from "@/lib/profiles/queries";
import { saveReview } from "@/lib/reviews/service";
import { cleanQuery, searchSite } from "@/lib/search/search";
import { blockUser } from "@/lib/social/blocks";
import { getDiscoverFeed } from "@/lib/social/feed";
import { fakeFetch, json } from "../helpers";

describe("parseFilters / filtersToQuery", () => {
  it("defaults to newest first with nothing set", () => {
    expect(parseFilters({})).toEqual({ sort: "recent" });
  });
  it("parses and round-trips a full set", () => {
    const f = parseFilters({
      sort: "rating",
      from: "1990",
      to: "1999",
      genre: " Post-Punk ",
      tag: "#Favorites",
      min: "3.5",
      max: "5",
    });
    expect(f).toEqual({
      sort: "rating",
      yearFrom: 1990,
      yearTo: 1999,
      genre: "post-punk",
      tag: "favorites",
      ratingMin: 7,
      ratingMax: 10,
    });
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(f))))).toEqual(f);
  });
  it("drops junk and swaps reversed ranges", () => {
    const f = parseFilters({
      sort: "DROP TABLE",
      from: "abc",
      to: "99999",
      min: "9",
      max: "0.3",
      genre: "",
    });
    expect(f).toEqual({ sort: "recent" });
    expect(parseFilters({ from: "2000", to: "1990" })).toMatchObject({
      yearFrom: 1990,
      yearTo: 2000,
    });
    expect(parseFilters({ min: "4", max: "2" })).toMatchObject({ ratingMin: 4, ratingMax: 8 });
  });
  it("treats 0 stars as a real rating bound", () => {
    expect(parseFilters({ min: "0", max: "0" })).toMatchObject({ ratingMin: 0, ratingMax: 0 });
  });
  it("takes the first of repeated params", () => {
    expect(parseFilters({ sort: ["year", "rating"] }).sort).toBe("year");
  });
});

describe("Odesli", () => {
  const entity = (id: string) => ({ entityUniqueId: id, url: "https://example.test" });
  it("extracts ids from a response", () => {
    const links = parseOdesliLinks({
      linksByPlatform: {
        spotify: entity("SPOTIFY_ALBUM::4LH4d3cOWNNsVw41Gqt2kv"),
        appleMusic: entity("ITUNES_ALBUM::1109714933"),
        deezer: entity("DEEZER_ALBUM::119606"),
        bandcamp: entity("BANDCAMP_ALBUM::x"),
      },
    });
    expect(links).toEqual({
      spotifyId: "4LH4d3cOWNNsVw41Gqt2kv",
      appleMusicId: "1109714933",
      deezerId: "119606",
      youtubeMusicId: undefined,
      tidalId: undefined,
    });
  });
  it("returns null when nothing usable or malformed", () => {
    expect(parseOdesliLinks({ linksByPlatform: {} })).toBeNull();
    expect(parseOdesliLinks({ nope: 1 })).toBeNull();
    expect(
      parseOdesliLinks({ linksByPlatform: { spotify: entity("SPOTIFY_ALBUM::bad id/../x") } }),
    ).toBeNull();
  });
  it("builds display URLs and refuses ids that aren't plain tokens", () => {
    const urls = platformUrls({
      spotifyId: "abc123",
      appleMusicId: "999",
      deezerId: "javascript:alert(1)",
      tidalId: null,
    });
    expect(urls.map((u) => u.key)).toEqual(["spotify", "appleMusic"]);
    expect(urls[0].url).toBe("https://open.spotify.com/album/abc123");
  });
  it("finds a source URL on Deezer only for a convincing match", async () => {
    const { fetch } = fakeFetch([
      [
        "api.deezer.com/search/album",
        () =>
          json({
            data: [
              {
                title: "Kid A (Live)",
                link: "https://deezer.test/live",
                artist: { name: "Radiohead" },
              },
              { title: "Kid A", link: "https://deezer.test/kida", artist: { name: "Radiohead" } },
              {
                title: "Kid A",
                link: "https://deezer.test/cover",
                artist: { name: "Some Tribute Band" },
              },
            ],
          }),
      ],
    ]);
    const url = await findAlbumSourceUrl(
      { artist: "Radiohead", title: "Kid A" },
      { fetchImpl: fetch },
    );
    expect(url).toBe("https://deezer.test/kida");
    const none = await findAlbumSourceUrl(
      { artist: "Nobody", title: "Nothing" },
      { fetchImpl: fetch },
    );
    expect(none).toBeNull();
  });
});

describe("direct lookups (no Odesli key needed)", () => {
  it("reads the Deezer id from an album URL", () => {
    expect(deezerIdFromUrl("https://www.deezer.com/album/14880741")).toBe("14880741");
    expect(deezerIdFromUrl("https://www.deezer.com/us/album/42?x=1")).toBe("42");
    expect(deezerIdFromUrl("https://example.com/album/5")).toBeUndefined();
  });
  it("finds the Apple Music album id from iTunes search, matching artist and title", async () => {
    const { fetch } = fakeFetch([
      [
        "itunes.apple.com/search",
        () =>
          json({
            results: [
              { collectionId: 1, collectionName: "Kid A", artistName: "Some Cover Band" },
              { collectionId: 2, collectionName: "Kid A (Live)", artistName: "Radiohead" },
              { collectionId: 1109714933, collectionName: "Kid A", artistName: "Radiohead" },
            ],
          }),
      ],
    ]);
    expect(
      await findAppleMusicAlbumId({ artist: "Radiohead", title: "Kid A" }, { fetchImpl: fetch }),
    ).toBe("1109714933");
    expect(
      await findAppleMusicAlbumId({ artist: "Nobody", title: "Nothing" }, { fetchImpl: fetch }),
    ).toBeNull();
  });
});

describe("discography", () => {
  const rg = (id: string, title: string, type: string, secondary: string[], date: string) => ({
    id,
    title,
    "primary-type": type,
    "secondary-types": secondary,
    "first-release-date": date,
    "artist-credit": [{ artist: { id: "a", name: "A" } }],
  });
  const json1 = {
    "release-groups": [
      rg("1", "Old", "Album", [], "1995"),
      rg("2", "Live!", "Album", ["Live"], "1996"),
      rg("3", "New EP", "EP", [], "2020-05"),
      rg("4", "A Single", "Single", [], "2001"),
      rg("5", "Best Of", "Album", ["Compilation"], "2010"),
    ],
  };
  it("keeps studio albums and EPs, newest first", () => {
    expect(parseDiscography(json1).map((a) => a.title)).toEqual(["New EP", "Old"]);
  });
  it("is fetched from MusicBrainz's browse endpoint", async () => {
    const { fetch, calls } = fakeFetch([["release-group?", () => json(json1)]]);
    const mb = createMusicBrainzProvider({ userAgent: "t/0 ( t )", fetchImpl: fetch, retries: 0 });
    expect((await mb.getDiscography("abc")).length).toBe(2);
    expect(calls[0].url).toContain("artist=abc");
  });
  it("merges with our library, which wins and carries ratings", () => {
    const lib: ArtistAlbum[] = [
      {
        mbid: "1",
        slug: "old",
        title: "Old",
        releaseDate: "1995",
        primaryType: "Album",
        coverKey: null,
        inLibrary: true,
        ratingCount: 3,
        average: "4.0",
        reviewCount: 1,
      },
    ];
    const merged = mergeDiscography(lib, parseDiscography(json1));
    expect(merged.map((a) => [a.title, a.inLibrary])).toEqual([
      ["New EP", false],
      ["Old", true],
    ]);
    expect(merged[1].average).toBe("4.0");
  });
});

describe("cleanQuery", () => {
  it("trims, collapses and bounds; too short becomes empty", () => {
    expect(cleanQuery("  kid   a ")).toBe("kid a");
    expect(cleanQuery("a")).toBe("");
    expect(cleanQuery(undefined)).toBe("");
    expect(cleanQuery("x".repeat(500))).toHaveLength(100);
  });
});

const { users, albums, artists, albumStats } = schema;
const DOMAIN = "@disc-test.invalid";
const viewerOf = (id: string) => ({ id, isAdmin: false });

describe.skipIf(!process.env.DATABASE_URL)("discovery against the database", () => {
  const db = getDb();
  const tag = randomUUID().slice(0, 8); // makes searchable words unique to this run
  let author: string; // public
  let priv: string; // private
  let blocked: string; // public, blocked by the viewer
  let viewer: string;
  let artistId: string;
  let a1: string; // 1995, post-rock
  let a2: string; // 2005, jazz
  let a3: string; // 2015, post-rock, no date for a4
  let a1Mbid: string;

  const album = async (title: string, releaseDate: string | null, genres: string[]) => {
    const [row] = await db
      .insert(albums)
      .values({ mbid: randomUUID(), title, slug: "x", artistId, releaseDate, genres })
      .returning({ id: albums.id, mbid: albums.mbid });
    await db.insert(albumStats).values({ albumId: row.id });
    return row;
  };
  const publish = (authorId: string, albumId: string, over = {}) =>
    saveReview(authorId, {
      albumId,
      title: null,
      body: "Some words.",
      rating: 6,
      clipTrackId: null,
      tags: [],
      status: "published",
      ...over,
    });

  beforeAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    const mk = async (name: string, over = {}) =>
      (
        await db
          .insert(users)
          .values({
            email: `${name}${DOMAIN}`,
            handle: `d_${name}${tag}`,
            displayName: name,
            ...over,
          })
          .returning({ id: users.id })
      )[0].id;
    author = await mk("author");
    priv = await mk("priv", { isPrivate: true });
    blocked = await mk("blocked");
    viewer = await mk("viewer");

    [{ id: artistId }] = await db
      .insert(artists)
      .values({ mbid: randomUUID(), name: `Zorbleflux${tag}`, slug: `disc-${randomUUID()}` })
      .returning({ id: artists.id });
    const r1 = await album(`Alpha ${tag}`, "1995-03", ["post-rock", "ambient"]);
    const r2 = await album(`Beta ${tag}`, "2005", ["jazz"]);
    const r3 = await album(`Gamma ${tag}`, "2015-09-01", ["Post-Rock"]);
    const r4 = await album(`Delta ${tag}`, null, []);
    [a1, a2, a3] = [r1.id, r2.id, r3.id];
    a1Mbid = r1.mbid;

    await publish(author, a1, {
      rating: 10,
      body: `luminescent ${tag} drones`,
      tags: ["Favorites"],
    });
    await publish(author, a2, { rating: 4, body: "" });
    await publish(author, a3, { rating: null, body: `brisk ${tag} guitars` });
    await publish(author, r4.id, { rating: 0, body: "" });
    await publish(priv, a1, { rating: 8, body: `secretive ${tag} notes` });
    await publish(blocked, a2, { rating: 6, body: `blockedword ${tag}` });
    await blockUser(viewer, blocked);
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    await db.delete(albums).where(eq(albums.artistId, artistId));
    await db.delete(artists).where(eq(artists.id, artistId));
    await db.$client.end();
  });

  const grid = (filters: Parameters<typeof parseFilters>[0], page = 1) =>
    getProfileGrid({ userId: author, viewer: null, filters: parseFilters(filters), page });
  const titles = (items: { album: { title: string } }[]) =>
    items.map((i) => i.album.title.replace(` ${tag}`, ""));

  describe("sort and filter", () => {
    it("sorts by rating, unrated and zero stars in their own places", async () => {
      const { items } = await grid({ sort: "rating" });
      // 5 stars, 2 stars, 0 stars (a real rating), then unrated last.
      expect(titles(items)).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
    });
    it("sorts by release year, undated last, and by oldest", async () => {
      expect(titles((await grid({ sort: "year" })).items)).toEqual([
        "Gamma",
        "Beta",
        "Alpha",
        "Delta",
      ]);
      const oldest = titles((await grid({ sort: "oldest" })).items);
      expect(oldest).toHaveLength(4);
    });
    it("filters by release year range and excludes undated albums", async () => {
      const r = await grid({ from: "2000", to: "2010" });
      expect(titles(r.items)).toEqual(["Beta"]);
      expect(r.total).toBe(1);
      expect(r.overall).toBe(4);
    });
    it("filters by genre case-insensitively", async () => {
      const r = await grid({ genre: "post-rock", sort: "year" });
      expect(titles(r.items)).toEqual(["Gamma", "Alpha"]);
    });
    it("filters by tag", async () => {
      expect(titles((await grid({ tag: "favorites" })).items)).toEqual(["Alpha"]);
      expect((await grid({ tag: "nonexistent" })).total).toBe(0);
    });
    it("filters by rating range; 0 stars matches, unrated never does", async () => {
      expect(titles((await grid({ min: "4" })).items)).toEqual(["Alpha"]);
      expect(titles((await grid({ min: "0", max: "0" })).items)).toEqual(["Delta"]);
      const all = await grid({ min: "0", max: "5" });
      expect(titles(all.items).sort()).toEqual(["Alpha", "Beta", "Delta"]);
    });
    it("pages non-default sorts with offsets", async () => {
      const p1 = await getProfileGrid({
        userId: author,
        viewer: null,
        filters: parseFilters({ sort: "rating" }),
        limit: 3,
      });
      expect(p1.items).toHaveLength(3);
      expect(p1.nextPage).toBe(2);
      const p2 = await getProfileGrid({
        userId: author,
        viewer: null,
        filters: parseFilters({ sort: "rating" }),
        limit: 3,
        page: 2,
      });
      expect(titles(p2.items)).toEqual(["Gamma"]);
      expect(p2.nextPage).toBeNull();
    });
    it("applies the same filters to Discover (written reviews, public authors)", async () => {
      const f = parseFilters({ genre: "post-rock" });
      const { items } = await getDiscoverFeed(null, undefined, { filters: f });
      const mine = items.filter((i) => i.album.title.endsWith(tag));
      expect(mine.map((i) => i.album.title.replace(` ${tag}`, "")).sort()).toEqual([
        "Alpha",
        "Gamma",
      ]); // the private author's Alpha review is not here
    });
  });

  describe("search", () => {
    it("finds an album, artist and review text, grouped", async () => {
      const r = await searchSite(`Zorbleflux${tag}`, null);
      expect(r.artists.map((a) => a.name)).toEqual([`Zorbleflux${tag}`]);
      expect(r.artists[0].albumCount).toBe(4);
      expect(r.albums.length).toBeGreaterThan(0);
      const reviews = await searchSite(`luminescent ${tag}`, null);
      expect(reviews.reviews).toHaveLength(1);
      expect(reviews.reviews[0].body).toContain("luminescent");
    });
    it("hides private authors' reviews from strangers, shows them to approved followers", async () => {
      expect((await searchSite(`secretive ${tag}`, viewerOf(viewer))).reviews).toHaveLength(0);
      expect((await searchSite(`secretive ${tag}`, null)).reviews).toHaveLength(0);
      const asSelf = await searchSite(`secretive ${tag}`, viewerOf(priv));
      expect(asSelf.reviews).toHaveLength(1);
    });
    it("hides blocked people and their reviews from the blocker", async () => {
      const r = await searchSite(`blockedword ${tag}`, viewerOf(viewer));
      expect(r.reviews).toHaveLength(0);
      const handles = async (v: ReturnType<typeof viewerOf> | null) =>
        (await searchSite(`d_blocked${tag}`, v)).people.map((p) => p.handle);
      expect(await handles(viewerOf(viewer))).not.toContain(`d_blocked${tag}`);
      // Anyone else still sees them.
      expect(await handles(null)).toContain(`d_blocked${tag}`);
    });
    it("finds people by @handle and still lists private accounts as people", async () => {
      const r = await searchSite(`@d_priv${tag}`, null);
      // Similar handles may come along (fuzzy match); the exact one ranks first.
      expect(r.people[0]).toMatchObject({ handle: `d_priv${tag}`, isPrivate: true });
    });
    it("hides suspended and deleted accounts", async () => {
      const handles = async () =>
        (await searchSite(`d_author${tag}`, null)).people.map((p) => p.handle);
      expect(await handles()).toContain(`d_author${tag}`);
      await db.update(users).set({ status: "suspended" }).where(eq(users.id, author));
      try {
        expect(await handles()).not.toContain(`d_author${tag}`);
        expect((await searchSite(`luminescent ${tag}`, null)).reviews).toHaveLength(0);
      } finally {
        await db.update(users).set({ status: "active" }).where(eq(users.id, author));
      }
    });
    it("returns nothing for a too-short query", async () => {
      expect(await searchSite("a", null)).toMatchObject({ albums: [], reviews: [] });
    });
  });

  describe("artist pages", () => {
    it("lists our albums with community averages and recent written reviews", async () => {
      const list = await getLibraryAlbums(artistId);
      expect(list).toHaveLength(4);
      const alpha = list.find((a) => a.mbid === a1Mbid)!;
      // author 5.0 stars + private author 4.0 stars both count (private ratings count anonymously)
      expect(alpha.ratingCount).toBe(2);
      expect(alpha.average).toBe("4.5");

      const rev = await getArtistReviews(null, artistId);
      // Anonymous visitors see public authors only (the private author's review is absent;
      // the blocked author's review is visible because the block is the viewer's alone).
      expect(rev.map((r) => r.body).sort()).toEqual([
        `blockedword ${tag}`,
        `brisk ${tag} guitars`,
        `luminescent ${tag} drones`,
      ]);
    });
  });

  describe("platform links job", () => {
    it("stores ids once found, and records an empty result without erasing anything", async () => {
      const found = await resolveAlbumLinks(a2, {
        links: {
          getPlatformLinks: async () => ({ spotifyId: "sp1", deezerId: "dz1" }),
        },
        findSource: async () => "https://deezer.test/x",
      });
      expect(found).toBe("found");
      let [row] = await db.select().from(albums).where(eq(albums.id, a2));
      expect(row).toMatchObject({ spotifyId: "sp1", deezerId: "dz1" });
      expect(row.linksResolvedAt).not.toBeNull();

      const none = await resolveAlbumLinks(a2, {
        links: { getPlatformLinks: async () => null },
        findSource: async () => null,
      });
      expect(none).toBe("none");
      [row] = await db.select().from(albums).where(eq(albums.id, a2));
      expect(row.spotifyId).toBe("sp1"); // kept
    });
    it("still stores Deezer and Apple ids when Odesli is unavailable (e.g. no API key)", async () => {
      const res = await resolveAlbumLinks(a3, {
        links: {
          getPlatformLinks: async () => {
            throw new Error("HTTP 401");
          },
        },
        findSource: async () => "https://www.deezer.com/album/777",
        findApple: async () => "888",
      });
      expect(res).toBe("found");
      const [row] = await db.select().from(albums).where(eq(albums.id, a3));
      expect(row).toMatchObject({ deezerId: "777", appleMusicId: "888", spotifyId: null });
      expect(row.linksResolvedAt).not.toBeNull();
    });
    it("reports a missing album", async () => {
      const res = await resolveAlbumLinks(randomUUID(), {
        links: { getPlatformLinks: async () => null },
      });
      expect(res).toBe("missing");
    });
  });
});
