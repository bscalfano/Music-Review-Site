/**
 * The first review of an artist pulls in their whole MusicBrainz discography, a page per job.
 * Runs against the real database with a fake MusicBrainz; throwaway rows only (@disc-import.invalid
 * and random MBIDs), removed afterwards. Skipped without DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { DISCOGRAPHY_PAGE_SIZE, importDiscographyPage } from "@/lib/albums/discography";
import { releaseCategory } from "@/lib/albums/release-types";
import type { AlbumCatalogProvider, AlbumSearchResult } from "@/lib/music";
import { saveReview, setQuickRating } from "@/lib/reviews/service";

const { users, artists, albums, jobs } = schema;
const DOMAIN = "@disc-import.invalid";

describe("releaseCategory", () => {
  it("lets a secondary type win over the primary type", () => {
    expect(releaseCategory("Album", [])).toBe("Albums");
    expect(releaseCategory("EP", [])).toBe("EPs");
    expect(releaseCategory("Single", [])).toBe("Singles");
    expect(releaseCategory("Album", ["Live"])).toBe("Live");
    expect(releaseCategory("Album", ["Compilation"])).toBe("Compilations");
    expect(releaseCategory("Album", ["Soundtrack"])).toBe("Soundtracks");
    expect(releaseCategory("Single", ["Remix"])).toBe("Remixes");
    expect(releaseCategory("Album", ["Demo"])).toBe("Other");
    expect(releaseCategory("Broadcast", [])).toBe("Other");
    expect(releaseCategory(null, [])).toBe("Other");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("discography import", () => {
  const db = getDb();
  let author: string;
  let artistId: string;
  let artistMbid: string;
  let firstAlbumId: string;
  const TOTAL = DISCOGRAPHY_PAGE_SIZE + 30;
  const all: AlbumSearchResult[] = [];

  const pendingImports = async () =>
    (await db.select().from(jobs).where(eq(jobs.type, "import_discography"))).filter(
      (j) => j.doneAt === null && (j.payload as { artistId?: string }).artistId === artistId,
    );

  const catalog = {
    getDiscography: async (_mbid: string, opts: { offset?: number; limit?: number } = {}) => ({
      total: TOTAL,
      items: all.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100)),
    }),
  } as unknown as AlbumCatalogProvider;

  beforeAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    [{ id: author }] = await db
      .insert(users)
      .values({ email: `author${DOMAIN}`, handle: "disc_import_author" })
      .returning({ id: users.id });
    artistMbid = randomUUID();
    [{ id: artistId }] = await db
      .insert(artists)
      .values({ mbid: artistMbid, name: "Import Band", slug: `import-band-${randomUUID()}` })
      .returning({ id: artists.id });
    const ref = { mbid: artistMbid, name: "Import Band", sortName: null };
    for (let i = 0; i < TOTAL; i++) {
      all.push({
        mbid: randomUUID(),
        title: `Release ${i}`,
        artist: ref,
        releaseDate: `${1990 + (i % 30)}`,
        primaryType: i % 3 === 0 ? "Single" : "Album",
        secondaryTypes: i % 5 === 0 ? ["Live"] : [],
      });
    }
    // The one album the first review is written about already exists in our library.
    const [first] = await db
      .insert(albums)
      .values({
        mbid: all[1].mbid,
        title: all[1].title,
        slug: "release-1",
        artistId,
        primaryType: "Album",
      })
      .returning({ id: albums.id });
    firstAlbumId = first.id;
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    await db.delete(albums).where(eq(albums.artistId, artistId));
    await db.delete(artists).where(eq(artists.id, artistId));
    await db
      .delete(jobs)
      .where(
        and(eq(jobs.type, "import_discography"), sql`${jobs.payload}->>'artistId' = ${artistId}`),
      );
  });

  const review = (status: "draft" | "published") => ({
    albumId: firstAlbumId,
    title: null,
    body: "",
    rating: 8,
    favoriteTrackId: null,
    tags: [],
    status,
  });

  it("does nothing for a draft", async () => {
    await saveReview(author, review("draft"));
    expect(await pendingImports()).toHaveLength(0);
  });

  it("queues the import when the first review is published, once", async () => {
    await saveReview(author, review("published"));
    await saveReview(author, review("published")); // saving again doesn't queue a second job
    await setQuickRating(author, firstAlbumId, 6);
    const queued = await pendingImports();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ artistId, offset: 0 });
  });

  it("imports page by page: every release type, and the artist is marked finished at the end", async () => {
    await importDiscographyPage(artistId, 0, { catalog });
    let [artist] = await db.select().from(artists).where(eq(artists.id, artistId));
    expect(artist.discographyImportedAt).toBeNull();
    // The next page was queued, as its own job.
    expect(
      (await pendingImports()).some(
        (j) => (j.payload as { offset: number }).offset === DISCOGRAPHY_PAGE_SIZE,
      ),
    ).toBe(true);

    await importDiscographyPage(artistId, DISCOGRAPHY_PAGE_SIZE, { catalog });
    [artist] = await db.select().from(artists).where(eq(artists.id, artistId));
    expect(artist.discographyImportedAt).not.toBeNull();

    const rows = await db.select().from(albums).where(eq(albums.artistId, artistId));
    expect(rows).toHaveLength(TOTAL);
    expect(rows.some((r) => r.primaryType === "Single")).toBe(true);
    expect(rows.find((r) => r.mbid === all[0].mbid)?.secondaryTypes).toEqual(["Live"]);
    // The album we already had is kept (same row) and gains its types.
    expect(rows.find((r) => r.mbid === all[1].mbid)?.id).toBe(firstAlbumId);
  });

  it("is safe to run again, and stops queueing once finished", async () => {
    await importDiscographyPage(artistId, 0, { catalog });
    expect(await db.select().from(albums).where(eq(albums.artistId, artistId))).toHaveLength(TOTAL);
    const before = (await pendingImports()).length;
    await saveReview(author, review("published"));
    expect((await pendingImports()).length).toBe(before);
  });
});
