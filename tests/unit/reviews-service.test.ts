/**
 * Integration test: the review service against the real database. Checks that publishing, editing,
 * unpublishing and deleting keep album_stats exactly in step, and the other write-path rules
 * (one review per album, quick logs, slugs, clips). Creates throwaway rows (@rev-test.invalid and
 * random MBIDs) and removes them afterwards. Skipped without DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { resolveTrackPreview } from "@/lib/albums/previews";
import { getAlbumStats, listAlbumReviews } from "@/lib/reviews/queries";
import {
  deleteReview,
  removeLog,
  ReviewError,
  saveReview,
  setQuickRating,
  type SaveReviewInput,
} from "@/lib/reviews/service";
import type { PreviewProvider } from "@/lib/music";

const { users, artists, albums, tracks, reviews, follows } = schema;
const DOMAIN = "@rev-test.invalid";

describe.skipIf(!process.env.DATABASE_URL)("review service keeps album_stats correct", () => {
  const db = getDb();
  let alice: string; // public
  let bob: string; // public
  let priv: string; // private account
  let albumId: string;
  let otherAlbumId: string;
  let sameTitleAlbumId: string;
  let clipTrackId: string;
  let otherAlbumTrackId: string;
  const artistIds: string[] = [];

  async function makeAlbum(title: string, withTrack: boolean) {
    const [artist] = await db
      .insert(artists)
      .values({ mbid: randomUUID(), name: "Test Artist", slug: `rev-test-${randomUUID()}` })
      .returning({ id: artists.id });
    artistIds.push(artist.id);
    const [album] = await db
      .insert(albums)
      .values({ mbid: randomUUID(), title, slug: "rev-test", artistId: artist.id })
      .returning({ id: albums.id });
    await db.insert(schema.albumStats).values({ albumId: album.id });
    let trackId = "";
    if (withTrack) {
      const [t] = await db
        .insert(tracks)
        .values({ albumId: album.id, title: "Opening Song", position: 1 })
        .returning({ id: tracks.id });
      trackId = t.id;
    }
    return { albumId: album.id, trackId };
  }

  const review = (over: Partial<SaveReviewInput> = {}): SaveReviewInput => ({
    albumId,
    title: null,
    body: "",
    rating: null,
    clipTrackId: null,
    tags: [],
    status: "published",
    ...over,
  });

  beforeAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    const rows = await db
      .insert(users)
      .values([
        { email: `alice${DOMAIN}`, handle: "rev_alice" },
        { email: `bob${DOMAIN}`, handle: "rev_bob" },
        { email: `priv${DOMAIN}`, handle: "rev_priv", isPrivate: true },
      ])
      .returning({ id: users.id });
    [alice, bob, priv] = rows.map((r) => r.id);

    const main = await makeAlbum("Stats Test Album", true);
    albumId = main.albumId;
    clipTrackId = main.trackId;
    const other = await makeAlbum("Another Album", true);
    otherAlbumId = other.albumId;
    otherAlbumTrackId = other.trackId;
    sameTitleAlbumId = (await makeAlbum("Stats Test Album", false)).albumId;
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`)); // cascades to reviews
    const ids = [albumId, otherAlbumId, sameTitleAlbumId];
    await db.delete(albums).where(inArray(albums.id, ids)); // cascades to tracks and stats
    await db.delete(artists).where(inArray(artists.id, artistIds));
    await db.$client.end();
  });

  it("starts empty", async () => {
    const s = await getAlbumStats(albumId);
    expect(s.ratingCount).toBe(0);
    expect(s.logCount).toBe(0);
  });

  it("a draft does not count", async () => {
    await saveReview(alice, review({ status: "draft", rating: 8, body: "wip" }));
    const s = await getAlbumStats(albumId);
    expect(s.ratingCount).toBe(0);
    expect(s.logCount).toBe(0);
  });

  it("publishing counts the rating, the log and the written review", async () => {
    const saved = await saveReview(alice, review({ rating: 8, body: "Great record." }));
    expect(saved.status).toBe("published");
    const s = await getAlbumStats(albumId);
    expect(s).toMatchObject({ ratingCount: 1, ratingSum: 8, logCount: 1, reviewCount: 1 });
    expect(s.histogram[8]).toBe(1);
  });

  it("is one review per author per album: saving again edits the same row", async () => {
    const before = await db.select().from(reviews).where(eq(reviews.authorId, alice));
    const saved = await saveReview(alice, review({ rating: 10, body: "Even better on rewatch." }));
    const after = await db.select().from(reviews).where(eq(reviews.authorId, alice));
    expect(after).toHaveLength(before.length);
    expect(after.find((r) => r.id === saved.id)?.rating).toBe(10);
    const s = await getAlbumStats(albumId);
    expect(s).toMatchObject({ ratingCount: 1, ratingSum: 10, logCount: 1 });
    expect(s.histogram[8]).toBe(0);
    expect(s.histogram[10]).toBe(1);
  });

  it("keeps the slug and original publish date when edited", async () => {
    const [row] = await db.select().from(reviews).where(eq(reviews.authorId, alice));
    const saved = await saveReview(alice, review({ rating: 9, body: "Edited again." }));
    const [after] = await db.select().from(reviews).where(eq(reviews.id, saved.id));
    expect(after.slug).toBe(row.slug);
    expect(after.publishedAt?.getTime()).toBe(row.publishedAt?.getTime());
  });

  it("clearing the rating keeps the log but removes it from the average", async () => {
    await saveReview(alice, review({ rating: null, body: "Words only." }));
    const s = await getAlbumStats(albumId);
    expect(s).toMatchObject({ ratingCount: 0, ratingSum: 0, logCount: 1, reviewCount: 1 });
    expect(s.histogram.every((n) => n === 0)).toBe(true);
  });

  it("zero stars is a real rating, different from no rating", async () => {
    await saveReview(alice, review({ rating: 0, body: "Nope." }));
    const s = await getAlbumStats(albumId);
    expect(s).toMatchObject({ ratingCount: 1, ratingSum: 0 });
    expect(s.histogram[0]).toBe(1);
  });

  it("ratings from several people, including a private account, are all averaged", async () => {
    await saveReview(alice, review({ rating: 8, body: "Back to 4 stars." }));
    await saveReview(bob, review({ rating: 5 }));
    await saveReview(priv, review({ rating: 10, body: "Private opinion." }));
    const s = await getAlbumStats(albumId);
    expect(s).toMatchObject({ ratingCount: 3, ratingSum: 23, logCount: 3, reviewCount: 2 });
  });

  it("private accounts' written reviews are hidden from strangers but still counted", async () => {
    const anon = await listAlbumReviews({ albumId, viewer: null, sort: "recent", limit: 10 });
    expect(anon.items.map((r) => r.author.handle)).toEqual(["rev_alice"]);

    const [privUser] = await db.select().from(users).where(eq(users.id, priv));
    expect(privUser.isPrivate).toBe(true);
    const bobViewer = { id: bob, isAdmin: false };
    const asBob = await listAlbumReviews({ albumId, viewer: bobViewer, sort: "recent", limit: 10 });
    expect(asBob.items.map((r) => r.author.handle)).not.toContain("rev_priv");

    await db.insert(follows).values({ followerId: bob, followeeId: priv, status: "accepted" });
    const asFollower = await listAlbumReviews({
      albumId,
      viewer: bobViewer,
      sort: "recent",
      limit: 10,
    });
    expect(asFollower.items.map((r) => r.author.handle).sort()).toEqual(["rev_alice", "rev_priv"]);
  });

  it("rating-only logs never show up in review lists", async () => {
    const all = await listAlbumReviews({
      albumId,
      viewer: { id: alice, isAdmin: true },
      sort: "recent",
      limit: 50,
    });
    expect(all.items.every((r) => r.body.trim() !== "")).toBe(true);
    expect(all.items.map((r) => r.author.handle)).not.toContain("rev_bob");
  });

  it("unpublishing removes the review from the stats; republishing restores it", async () => {
    await saveReview(priv, review({ rating: 10, body: "Private opinion.", status: "draft" }));
    expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 2, ratingSum: 13 });
    await saveReview(priv, review({ rating: 10, body: "Private opinion." }));
    expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 3, ratingSum: 23 });
  });

  it("deleting a review removes it from the stats and lists, and only its author can delete", async () => {
    const [bobsReview] = await db.select().from(reviews).where(eq(reviews.authorId, bob));
    expect(await deleteReview(alice, bobsReview.id)).toBe(false); // not alice's
    expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 3 });

    expect(await deleteReview(bob, bobsReview.id)).toBe(true);
    expect(await getAlbumStats(albumId)).toMatchObject({
      ratingCount: 2,
      ratingSum: 18,
      logCount: 2,
    });
    expect(await deleteReview(bob, bobsReview.id)).toBe(false); // already gone
  });

  it("after deleting, the author can review the album again", async () => {
    await saveReview(bob, review({ rating: 4, body: "Second thoughts." }));
    expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 3, ratingSum: 22 });
  });

  describe("quick log (S23)", () => {
    it("creates a published rating-only log from one click", async () => {
      const carol = (
        await db
          .insert(users)
          .values({ email: `carol${DOMAIN}`, handle: "rev_carol" })
          .returning({ id: users.id })
      )[0].id;
      const res = await setQuickRating(carol, albumId, 6);
      expect(res.kind).toBe("logged");
      const [row] = await db.select().from(reviews).where(eq(reviews.authorId, carol));
      expect(row).toMatchObject({ rating: 6, body: "", status: "published" });
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 4, ratingSum: 28 });
    });

    it("changing the rating updates the same log; null means listened without stars", async () => {
      const [carol] = await db.select().from(users).where(eq(users.handle, "rev_carol"));
      await setQuickRating(carol.id, albumId, 9);
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 4, ratingSum: 31 });
      await setQuickRating(carol.id, albumId, null);
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 3, logCount: 4 });
    });

    it("does not publish an existing draft", async () => {
      await saveReview(alice, review({ albumId: otherAlbumId, status: "draft", body: "wip" }));
      const res = await setQuickRating(alice, otherAlbumId, 7);
      expect(res.kind).toBe("draft");
      expect(await getAlbumStats(otherAlbumId)).toMatchObject({ ratingCount: 0, logCount: 0 });
    });

    it("removeLog deletes a rating-only log but never a written review", async () => {
      const [carol] = await db.select().from(users).where(eq(users.handle, "rev_carol"));
      expect(await removeLog(carol.id, albumId)).toBe(true);
      expect(await getAlbumStats(albumId)).toMatchObject({ logCount: 3 });
      expect(await removeLog(alice, albumId)).toBe(false); // alice wrote text
      expect(await getAlbumStats(albumId)).toMatchObject({ logCount: 3 });
    });

    it("rejects out-of-range ratings", async () => {
      await expect(setQuickRating(alice, albumId, 11)).rejects.toBeInstanceOf(ReviewError);
      await expect(setQuickRating(alice, albumId, -1)).rejects.toBeInstanceOf(ReviewError);
    });
  });

  describe("write-path rules", () => {
    it("gives an author different slugs for different albums with the same title", async () => {
      const [main] = await db.select().from(reviews).where(eq(reviews.authorId, bob));
      expect(main.slug).toBe("stats-test-album");
      const second = await saveReview(bob, review({ albumId: sameTitleAlbumId, rating: 6 }));
      expect(second.slug).toBe("stats-test-album-2");
    });

    it("only allows a clip from the same album", async () => {
      const ok = await saveReview(alice, review({ clipTrackId }));
      expect(ok.status).toBe("published");
      await expect(
        saveReview(alice, review({ clipTrackId: otherAlbumTrackId })),
      ).rejects.toMatchObject({
        code: "bad_clip",
      });
    });

    it("only allows a favorite song from the same album", async () => {
      const ok = await saveReview(alice, review({ favoriteTrackId: clipTrackId }));
      const [row] = await db.select().from(reviews).where(eq(reviews.id, ok.id));
      expect(row.favoriteTrackId).toBe(clipTrackId);
      await expect(
        saveReview(alice, review({ favoriteTrackId: otherAlbumTrackId })),
      ).rejects.toMatchObject({ code: "bad_favorite" });
    });

    it("refuses to edit someone else's review by id", async () => {
      const [bobsReview] = await db.select().from(reviews).where(eq(reviews.authorId, bob));
      await expect(
        saveReview(alice, review({ reviewId: bobsReview.id, body: "hijack" })),
      ).rejects.toMatchObject({ code: "not_found" });
      const [after] = await db.select().from(reviews).where(eq(reviews.id, bobsReview.id));
      expect(after.body).not.toBe("hijack");
    });

    it("stores tags once, lowercased, and replaces them on edit", async () => {
      const saved = await saveReview(alice, review({ body: "x", tags: ["Shoegaze", "dream pop"] }));
      const tagRows = async () =>
        (
          await db
            .select({ name: schema.tags.name })
            .from(schema.reviewTags)
            .innerJoin(schema.tags, eq(schema.reviewTags.tagId, schema.tags.id))
            .where(eq(schema.reviewTags.reviewId, saved.id))
        )
          .map((r) => r.name)
          .sort();
      expect(await tagRows()).toEqual(["dream pop", "shoegaze"]);
      await saveReview(alice, review({ body: "x", tags: ["shoegaze"] }));
      expect(await tagRows()).toEqual(["shoegaze"]);
    });
  });

  describe("song clips", () => {
    const calls: string[] = [];
    const provider = (url: string | null): PreviewProvider => ({
      name: "deezer",
      async findPreview(q) {
        calls.push(q.title);
        return url ? { url, source: "deezer", expiresAt: null } : null;
      },
    });

    it("looks a clip up once, stores it, and reuses it while fresh", async () => {
      const url = "https://cdn.example.com/opening.mp3";
      expect(await resolveTrackPreview(clipTrackId, { previews: [provider(url)] })).toBe(url);
      expect(
        await resolveTrackPreview(clipTrackId, { previews: [provider("https://other")] }),
      ).toBe(url);
      expect(calls).toEqual(["Opening Song"]);
    });

    it("re-resolves when forced (playback failed), but not more than once a minute", async () => {
      const fresh = "https://cdn.example.com/opening-v2.mp3";
      // The previous test just checked the track, so this force is rate limited.
      expect(
        await resolveTrackPreview(clipTrackId, { force: true, previews: [provider(fresh)] }),
      ).toBe("https://cdn.example.com/opening.mp3");
      const later = new Date(Date.now() + 5 * 60 * 1000);
      expect(
        await resolveTrackPreview(clipTrackId, {
          force: true,
          previews: [provider(fresh)],
          now: later,
        }),
      ).toBe(fresh);
    });

    it("remembers that a track has no clip instead of searching on every play", async () => {
      calls.length = 0;
      expect(
        await resolveTrackPreview(otherAlbumTrackId, { previews: [provider(null)] }),
      ).toBeNull();
      expect(
        await resolveTrackPreview(otherAlbumTrackId, { previews: [provider(null)] }),
      ).toBeNull();
      expect(calls).toHaveLength(1);
    });
  });
});
