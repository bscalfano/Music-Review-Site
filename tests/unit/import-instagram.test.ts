/**
 * Instagram import (S3): parser unit tests, plus a DB integration test of staging and publishing
 * (skipped without DATABASE_URL; throwaway @import-test.invalid user and random MBIDs).
 */
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { fixMojibake, parseCaption, parsePostsJson, parseRating } from "@/lib/import/instagram";
import {
  bestMatch,
  importCounts,
  listItems,
  publishItems,
  setSkipped,
  stageExport,
  updateItem,
} from "@/lib/import/service";

/** What Instagram's exporter does to UTF-8 text. */
const mangle = (s: string) => Buffer.from(s, "utf8").toString("latin1");

describe("fixMojibake", () => {
  it("repairs accents and emoji", () => {
    expect(fixMojibake(mangle("Björk – Homogénic 😍"))).toBe("Björk – Homogénic 😍");
  });
  it("leaves already-correct text alone", () => {
    expect(fixMojibake("Björk – 😍")).toBe("Björk – 😍");
    expect(fixMojibake("plain ascii")).toBe("plain ascii");
  });
  it("leaves latin-1 text that isn't valid UTF-8 alone", () => {
    expect(fixMojibake("café")).toBe("café"); // a lone é byte is not valid UTF-8
  });
});

describe("parsePostsJson", () => {
  it("reads posts, repairing text and using the first media for missing fields", () => {
    const { posts, skipped } = parsePostsJson([
      {
        media: [
          {
            uri: "media/posts/a.jpg",
            creation_timestamp: 1_600_000_000,
            title: mangle("Kid A – Radiohead ★★★★½"),
          },
        ],
      },
      { title: "No date here", media: [] },
      "garbage",
      { title: "Top level", creation_timestamp: 1_500_000_000, media: [{ uri: "b.jpg" }] },
    ]);
    expect(skipped).toBe(2);
    expect(posts).toHaveLength(2);
    expect(posts[0].caption).toBe("Kid A – Radiohead ★★★★½");
    expect(posts[0].postedAt.toISOString()).toBe("2020-09-13T12:26:40.000Z");
    expect(posts[0].imagePath).toBe("media/posts/a.jpg");
    expect(posts[1].caption).toBe("Top level");
  });
  it("has stable, distinct source keys", () => {
    const a = parsePostsJson([{ title: "x", creation_timestamp: 1, media: [] }]).posts[0];
    const b = parsePostsJson([{ title: "x", creation_timestamp: 1, media: [] }]).posts[0];
    const c = parsePostsJson([{ title: "y", creation_timestamp: 1, media: [] }]).posts[0];
    expect(a.sourceKey).toBe(b.sourceKey);
    expect(a.sourceKey).not.toBe(c.sourceKey);
  });
  it("accepts a wrapper object and rejects other shapes", () => {
    expect(parsePostsJson({ posts: [] }).posts).toEqual([]);
    expect(() => parsePostsJson({ nope: 1 })).toThrow();
    expect(() => parsePostsJson("hi")).toThrow();
  });
});

describe("parseRating", () => {
  it.each([
    ["4.5/5", 9],
    ["9/10", 9],
    ["10/10", 10],
    ["0/5", 0],
    ["★★★★½", 9],
    ["⭐⭐⭐", 6],
    ["3.5 stars", 7],
    ["a great record", null],
    ["7/5", null], // out of range
    ["released 1997", null],
  ])("%s -> %s", (text, expected) => {
    expect(parseRating(text)).toBe(expected);
  });
});

describe("parseCaption", () => {
  it("offers both artist/album orderings for a dashed headline", () => {
    const { candidates } = parseCaption("Kid A – Radiohead (2000)\n\nCold and brilliant.");
    expect(candidates).toContainEqual({ artist: "Radiohead", title: "Kid A" });
    expect(candidates).toContainEqual({ artist: "Kid A", title: "Radiohead" });
  });
  it("understands 'Album by Artist'", () => {
    const { candidates } = parseCaption("OK Computer by Radiohead");
    expect(candidates[0]).toEqual({ artist: "Radiohead", title: "OK Computer" });
  });
  it("keeps hyphens inside names", () => {
    const { candidates } = parseCaption("Jay-Z – The Blueprint");
    expect(candidates).toContainEqual({ artist: "Jay-Z", title: "The Blueprint" });
  });
  it("splits the body, rating line and hashtags out", () => {
    const parsed = parseCaption(
      "Kid A – Radiohead\n★★★★½\n\nCold and brilliant.\n\n#radiohead #Art_Rock",
    );
    expect(parsed.rating).toBe(9);
    expect(parsed.hashtags).toEqual(["radiohead", "art_rock"]);
    expect(parsed.body).toBe("Cold and brilliant.");
  });
  it("copes with empty or headline-less captions", () => {
    expect(parseCaption("").candidates).toEqual([]);
    expect(parseCaption("#vibes #music").candidates).toEqual([]);
    expect(parseCaption("Just one thought").candidates).toEqual([]);
  });
});

describe("bestMatch", () => {
  const matches = [
    { mbid: "a", title: "Kid A", artist: "Radiohead", releaseDate: "2000" },
    { mbid: "b", title: "Kid A Mnesia", artist: "Radiohead", releaseDate: "2021" },
  ];
  it("pre-selects only an unambiguous exact match, ignoring case and accents", () => {
    expect(bestMatch([{ artist: "radiohead", title: "KID A" }], matches)).toBe("a");
  });
  it("returns null when nothing or several match", () => {
    expect(bestMatch([{ artist: "Radiohead", title: "Amnesiac" }], matches)).toBeNull();
    expect(bestMatch([], matches)).toBeNull();
    expect(
      bestMatch(
        [{ artist: "Radiohead", title: "Kid A" }],
        [matches[0], { ...matches[0], mbid: "z" }],
      ),
    ).toBeNull();
  });
});

const { users, albums, artists, reviews, importItems, albumStats } = schema;
const DOMAIN = "@import-test.invalid";

describe.skipIf(!process.env.DATABASE_URL)("staging and publishing", () => {
  const db = getDb();
  let ownerId: string;
  let albumMbid: string;
  let albumId: string;
  let artistId: string;

  const json = [
    { title: "Test Album – Test Artist 4/5", creation_timestamp: 1_500_000_000, media: [] },
    { title: "Another – Someone", creation_timestamp: 1_510_000_000, media: [] },
    { title: "No timestamp", media: [] },
  ];

  beforeAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    [{ id: ownerId }] = await db
      .insert(users)
      .values({
        email: `owner${DOMAIN}`,
        handle: "import_owner",
        displayName: "Owner",
        role: "owner",
      })
      .returning({ id: users.id });
    albumMbid = randomUUID();
    [{ id: artistId }] = await db
      .insert(artists)
      .values({ mbid: randomUUID(), name: "Test Artist", slug: `ia-${randomUUID()}` })
      .returning({ id: artists.id });
    [{ id: albumId }] = await db
      .insert(albums)
      .values({ mbid: albumMbid, title: "Test Album", slug: "test-album", artistId })
      .returning({ id: albums.id });
    await db.insert(albumStats).values({ albumId });
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`)); // cascades staged items + reviews
    await db.delete(albums).where(eq(albums.id, albumId));
    await db.delete(artists).where(eq(artists.id, artistId));
    await db.$client.end();
  });

  it("stages posts idempotently", async () => {
    const first = await stageExport(ownerId, json);
    expect(first).toEqual({ added: 2, duplicates: 0, skipped: 1 });
    const again = await stageExport(ownerId, json);
    expect(again).toEqual({ added: 0, duplicates: 2, skipped: 1 });
    expect(await importCounts(ownerId)).toEqual({ pending: 2, skipped: 0, imported: 0 });
  });

  it("pre-fills rating from the caption, oldest post first", async () => {
    const items = await listItems(ownerId, "pending");
    expect(items.map((i) => i.caption)[0]).toContain("Test Album");
    expect(items[0].rating).toBe(8);
  });

  it("refuses to publish without an album, then publishes with the original date", async () => {
    const [item] = await listItems(ownerId, "pending");
    const [blocked] = await publishItems(ownerId, [item.id]);
    expect(blocked).toMatchObject({ ok: false, message: "Pick an album first." });

    await updateItem(ownerId, item.id, {
      title: "A title",
      body: "Imported text",
      rating: 8,
      albumMbid,
      tags: ["Indie Rock", "indie rock"],
    });
    const [done] = await publishItems(ownerId, [item.id]);
    expect(done.ok).toBe(true);

    const [review] = await db.select().from(reviews).where(eq(reviews.authorId, ownerId));
    expect(review).toMatchObject({
      status: "published",
      importedFrom: "instagram",
      title: "A title",
      rating: 8,
    });
    expect(review.publishedAt?.toISOString()).toBe(new Date(1_500_000_000 * 1000).toISOString());
    const [stats] = await db.select().from(albumStats).where(eq(albumStats.albumId, albumId));
    expect(stats.reviewCount).toBe(1);
    expect(await importCounts(ownerId)).toMatchObject({ pending: 1, imported: 1 });
  });

  it("won't publish a second review of the same album", async () => {
    const [item] = await listItems(ownerId, "pending");
    await updateItem(ownerId, item.id, {
      title: null,
      body: "",
      rating: null,
      albumMbid,
      tags: [],
    });
    const [res] = await publishItems(ownerId, [item.id]);
    expect(res).toMatchObject({ ok: false, message: "You already have a review of this album." });
    const [row] = await db.select().from(importItems).where(eq(importItems.id, item.id));
    expect(row.status).toBe("pending");
    expect(row.error).toMatch(/already/);
  });

  it("skips and restores, and never touches another owner's items", async () => {
    const [item] = await listItems(ownerId, "pending");
    await setSkipped(randomUUID(), [item.id], true); // someone else
    expect((await importCounts(ownerId)).skipped).toBe(0);
    await setSkipped(ownerId, [item.id], true);
    expect(await importCounts(ownerId)).toMatchObject({ pending: 0, skipped: 1 });
    await setSkipped(ownerId, [item.id], false);
    expect((await importCounts(ownerId)).pending).toBe(1);
  });
});
