/**
 * Phase 8: lists (S11), the listening queue and suggestions (S14), and per-user stats (S10).
 * DB integration tests with throwaway @ext-test.invalid users and random MBIDs (skipped without
 * DATABASE_URL).
 */
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import {
  deleteList,
  getList,
  getListForEdit,
  listInputSchema,
  listsForUser,
  saveList,
} from "@/lib/lists/service";
import {
  addToQueue,
  countSuggestions,
  getQueueState,
  listQueue,
  listSuggestions,
  removeFromQueue,
  respondToSuggestion,
  suggestAlbum,
} from "@/lib/queue/service";
import { saveReview, setQuickRating } from "@/lib/reviews/service";
import { blockUser } from "@/lib/social/blocks";
import { followUser, respondToFollowRequest } from "@/lib/social/follows";
import { listNotifications } from "@/lib/social/notifications";
import { getUserStats, toDistribution, toStars } from "@/lib/stats/user-stats";

const { users, albums, artists, albumStats, queueItems, notifications } = schema;
const DOMAIN = "@ext-test.invalid";
const viewerOf = (id: string) => ({ id, isAdmin: false });

describe("stats helpers", () => {
  it("builds an 11-bucket distribution", () => {
    const d = toDistribution([
      { rating: 0, n: 2 },
      { rating: 7, n: 3 },
      { rating: 10, n: 1 },
    ]);
    expect(d).toHaveLength(11);
    expect([d[0], d[7], d[10]]).toEqual([2, 3, 1]);
  });
  it("converts half-star averages to stars", () => {
    expect(toStars(7)).toBe(3.5);
    expect(toStars(8.4)).toBe(4.2);
    expect(toStars(null)).toBeNull();
  });
});

describe("list input validation", () => {
  const ok = {
    title: "Best of 2025",
    description: "",
    ranked: true,
    year: 2025,
    status: "draft",
    items: [],
  };
  it("accepts a valid list and cleans text", () => {
    const r = listInputSchema.parse({ ...ok, title: "  Hi  ", description: "  " });
    expect(r.title).toBe("Hi");
    expect(r.description).toBeNull();
  });
  it("rejects empty titles, silly years and oversize lists", () => {
    expect(listInputSchema.safeParse({ ...ok, title: " " }).success).toBe(false);
    expect(listInputSchema.safeParse({ ...ok, year: 1066 }).success).toBe(false);
    const items = Array.from({ length: 101 }, () => ({ albumMbid: randomUUID(), note: "" }));
    expect(listInputSchema.safeParse({ ...ok, items }).success).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("lists, queue and stats", () => {
  const db = getDb();
  let owner: string; // public
  let priv: string; // private
  let stranger: string;
  let follower: string; // approved follower of priv
  let closed: string; // suggestions off
  let artistA: string;
  let artistB: string;
  const al: { id: string; mbid: string }[] = [];

  const mkAlbum = async (artistId: string, title: string, releaseDate: string | null) => {
    const [row] = await db
      .insert(albums)
      .values({ mbid: randomUUID(), title, slug: "x", artistId, releaseDate })
      .returning({ id: albums.id, mbid: albums.mbid });
    await db.insert(albumStats).values({ albumId: row.id });
    al.push(row);
    return row;
  };
  const publish = (authorId: string, albumId: string, over = {}) =>
    saveReview(authorId, {
      albumId,
      title: null,
      body: "words",
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
          .values({ email: `${name}${DOMAIN}`, handle: `x_${name}`, displayName: name, ...over })
          .returning({ id: users.id })
      )[0].id;
    owner = await mk("owner");
    priv = await mk("priv", { isPrivate: true });
    stranger = await mk("stranger");
    follower = await mk("follower");
    closed = await mk("closed", { acceptSuggestions: false });
    await followUser(follower, priv);
    await respondToFollowRequest(priv, follower, true);

    [{ id: artistA }, { id: artistB }] = await db
      .insert(artists)
      .values([
        { mbid: randomUUID(), name: "Ext Artist A", slug: `ext-a-${randomUUID()}` },
        { mbid: randomUUID(), name: "Ext Artist B", slug: `ext-b-${randomUUID()}` },
      ])
      .returning({ id: artists.id });
    await mkAlbum(artistA, "A1", "1994-02");
    await mkAlbum(artistA, "A2", "1999");
    await mkAlbum(artistA, "A3", "2005-06-01");
    await mkAlbum(artistB, "B1", "2005");
    await mkAlbum(artistB, "B2", null);
    await mkAlbum(artistB, "B3", "2011");
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    for (const a of al) await db.delete(albums).where(eq(albums.id, a.id));
    for (const id of [artistA, artistB]) await db.delete(artists).where(eq(artists.id, id));
    await db.$client.end();
  });

  describe("queue", () => {
    it("adds, refuses duplicates, and removes", async () => {
      expect(await addToQueue(owner, al[0].id, "  heard good things ")).toBe("added");
      expect(await addToQueue(owner, al[0].id)).toBe("already_queued");
      expect(await getQueueState(owner, al[0].id)).toBe("queued");
      const q = await listQueue(owner);
      expect(q).toHaveLength(1);
      expect(q[0].note).toBe("heard good things");
      await removeFromQueue(owner, al[0].id);
      expect(await getQueueState(owner, al[0].id)).toBeNull();
    });

    it("refuses albums you already reviewed", async () => {
      await publish(stranger, al[1].id);
      expect(await addToQueue(stranger, al[1].id)).toBe("already_reviewed");
    });

    it("marks a queued album reviewed when you publish a review, a log, but not a draft", async () => {
      await addToQueue(owner, al[0].id);
      await publish(owner, al[0].id, { status: "draft" });
      expect(await getQueueState(owner, al[0].id)).toBe("queued");
      await publish(owner, al[0].id);
      expect(await getQueueState(owner, al[0].id)).toBeNull();
      const [row] = await db
        .select()
        .from(queueItems)
        .where(and(eq(queueItems.ownerId, owner), eq(queueItems.albumId, al[0].id)));
      expect(row.status).toBe("reviewed");

      await addToQueue(owner, al[2].id);
      await setQuickRating(owner, al[2].id, 8);
      expect(await getQueueState(owner, al[2].id)).toBeNull();
    });

    it("lets people suggest albums, notifying the owner", async () => {
      expect(await suggestAlbum(stranger, owner, al[3].id, "you'll love it")).toBe("suggested");
      expect(await countSuggestions(owner)).toBe(1);
      // Suggestions aren't part of the public queue.
      expect((await listQueue(owner)).map((e) => e.album.title)).not.toContain("B1");
      const [s] = await listSuggestions(owner);
      expect(s).toMatchObject({ note: "you'll love it", suggestedBy: { handle: "x_stranger" } });
      const { items } = await listNotifications(owner);
      expect(items.some((n) => n.type === "suggestion" && n.actor.handle === "x_stranger")).toBe(
        true,
      );
      // Same album again: no second entry.
      expect(await suggestAlbum(follower, owner, al[3].id)).toBe("already_queued");
    });

    it("accepting moves it to the queue; dismissing removes the notification", async () => {
      const [s] = await listSuggestions(owner);
      expect(await respondToSuggestion(owner, s.id, true)).toBe(true);
      expect(await getQueueState(owner, al[3].id)).toBe("queued");
      expect(await respondToSuggestion(owner, s.id, true)).toBe(false); // already decided

      await suggestAlbum(stranger, owner, al[4].id);
      const [t] = await listSuggestions(owner);
      expect(await respondToSuggestion(stranger, t.id, true)).toBe(false); // not theirs
      expect(await respondToSuggestion(owner, t.id, false)).toBe(true);
      expect(await getQueueState(owner, al[4].id)).toBeNull();
      const rows = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.recipientId, owner), eq(notifications.targetId, al[4].id)));
      expect(rows).toHaveLength(0);
    });

    it("adding something that was suggested to you just accepts it", async () => {
      await suggestAlbum(follower, owner, al[5].id);
      expect(await addToQueue(owner, al[5].id)).toBe("added");
      expect(await countSuggestions(owner)).toBe(0);
    });

    it("refuses suggestions to yourself, people with them off, private strangers and blockers", async () => {
      await expect(suggestAlbum(owner, owner, al[0].id)).rejects.toThrow();
      await expect(suggestAlbum(stranger, closed, al[0].id)).rejects.toThrow(/isn't taking/);
      // A private account looks like it doesn't exist to people who can't see it.
      await expect(suggestAlbum(stranger, priv, al[0].id)).rejects.toThrow(/doesn't exist/);
      expect(await suggestAlbum(follower, priv, al[0].id)).toBe("suggested");
      await blockUser(owner, stranger);
      await expect(suggestAlbum(stranger, owner, al[0].id)).rejects.toThrow(/doesn't exist/);
    });

    it("won't suggest what someone has already reviewed", async () => {
      expect(await suggestAlbum(follower, owner, al[0].id)).toBe("already_reviewed");
    });
  });

  describe("lists", () => {
    const input = (over = {}) =>
      listInputSchema.parse({
        title: "Top albums",
        description: "My picks",
        ranked: true,
        year: 2025,
        status: "published",
        items: [],
        ...over,
      });

    it("creates a list with ordered items and links the author's own reviews", async () => {
      const saved = await saveList(
        owner,
        null,
        input({
          items: [
            { albumMbid: al[2].mbid, note: "best" },
            { albumMbid: al[1].mbid, note: "" },
            { albumMbid: al[2].mbid, note: "duplicate ignored" },
          ],
        }),
      );
      expect(saved.slug).toBe("top-albums");
      const list = await getList("x_owner", "top-albums", null);
      expect(list?.items.map((i) => [i.position, i.album.title, i.note])).toEqual([
        [1, "A3", "best"],
        [2, "A2", null],
      ]);
      // owner reviewed A3 (quick log) but not A2
      expect(list?.items[0].reviewSlug).not.toBeNull();
      expect(list?.items[1].reviewSlug).toBeNull();
    });

    it("gives repeated titles distinct slugs and replaces items on edit", async () => {
      const second = await saveList(
        owner,
        null,
        input({ items: [{ albumMbid: al[0].mbid, note: "" }] }),
      );
      expect(second.slug).toBe("top-albums-2");
      const edited = await saveList(
        owner,
        second.id,
        input({ title: "Renamed", items: [{ albumMbid: al[1].mbid, note: "n" }] }),
      );
      expect(edited.slug).toBe("renamed");
      const edit = await getListForEdit(owner, second.id);
      expect(edit?.items.map((i) => i.title)).toEqual(["A2"]);
    });

    it("keeps drafts private to the author", async () => {
      const draft = await saveList(owner, null, input({ title: "Secret draft", status: "draft" }));
      expect(await getList("x_owner", draft.slug, null)).toBeNull();
      expect(await getList("x_owner", draft.slug, viewerOf(stranger))).toBeNull();
      expect(await getList("x_owner", draft.slug, viewerOf(owner))).not.toBeNull();
      expect((await listsForUser(owner, false)).map((l) => l.title)).not.toContain("Secret draft");
      expect((await listsForUser(owner, true)).map((l) => l.title)).toContain("Secret draft");
    });

    it("hides lists of private accounts from non-followers", async () => {
      await saveList(priv, null, input({ title: "Private picks" }));
      expect(await getList("x_priv", "private-picks", null)).toBeNull();
      expect(await getList("x_priv", "private-picks", viewerOf(stranger))).toBeNull();
      expect(await getList("x_priv", "private-picks", viewerOf(follower))).not.toBeNull();
    });

    it("only lets the author edit or delete", async () => {
      const [mine] = await listsForUser(owner, true);
      await expect(saveList(stranger, mine.id, input())).rejects.toThrow(/doesn't exist/);
      expect(await deleteList(stranger, mine.id)).toBe(false);
      expect(await deleteList(owner, mine.id)).toBe(true);
    });

    it("refuses to edit a list a moderator took down", async () => {
      const saved = await saveList(owner, null, input({ title: "Taken down" }));
      await db.update(schema.lists).set({ status: "hidden" }).where(eq(schema.lists.id, saved.id));
      await expect(saveList(owner, saved.id, input({ title: "Taken down" }))).rejects.toThrow(
        /took this list down/,
      );
      expect(await getList("x_owner", saved.slug, null)).toBeNull();
    });
  });

  describe("stats", () => {
    let statsUser: string;
    beforeAll(async () => {
      statsUser = (
        await db
          .insert(users)
          .values({ email: `stats${DOMAIN}`, handle: "x_stats", displayName: "Stats" })
          .returning({ id: users.id })
      )[0].id;
      // A1 1994 5★, A2 1999 0★, A3 2005 3.5★, B1 2005 unrated, B3 2011 4★
      await publish(statsUser, al[0].id, { rating: 10 });
      await publish(statsUser, al[1].id, { rating: 0 });
      await publish(statsUser, al[2].id, { rating: 7 });
      await publish(statsUser, al[3].id, { rating: null, body: "" });
      await publish(statsUser, al[5].id, { rating: 8 });
      await publish(statsUser, al[4].id, { rating: 4, status: "draft" }); // drafts don't count
    });

    it("computes totals, distribution, artists and decades", async () => {
      const s = await getUserStats(statsUser, null);
      expect(s.total).toBe(5); // the draft isn't counted
      expect(s.rated).toBe(4);
      expect(s.average).toBe(3.1); // (10 + 0 + 7 + 8) / 4 = 6.25 half-stars
      // 0 stars is a real rating; the unrated one isn't in the distribution.
      expect(s.distribution.reduce((a, b) => a + b, 0)).toBe(4);
      expect([s.distribution[0], s.distribution[7], s.distribution[8], s.distribution[10]]).toEqual(
        [1, 1, 1, 1],
      );
      expect(s.perYear).toEqual([{ year: new Date().getFullYear(), count: 5 }]);
      expect(s.topArtists.map((a) => [a.name, a.count, a.average])).toEqual([
        ["Ext Artist A", 3, 2.8],
        ["Ext Artist B", 2, 4],
      ]);
      expect(s.byDecade).toEqual([
        { decade: 1990, count: 2, average: 2.5 },
        { decade: 2000, count: 1, average: 3.5 },
        { decade: 2010, count: 1, average: 4 },
      ]);
    });

    it("shows nothing about a private account to people who can't see it", async () => {
      await publish(priv, al[0].id, { rating: 6 });
      expect((await getUserStats(priv, null)).total).toBe(0);
      expect((await getUserStats(priv, viewerOf(stranger))).total).toBe(0);
      expect((await getUserStats(priv, viewerOf(follower))).total).toBe(1);
      expect((await getUserStats(priv, viewerOf(priv))).total).toBe(1);
    });

    it("is empty for someone with no reviews", async () => {
      const s = await getUserStats(closed, null);
      expect(s).toMatchObject({ total: 0, rated: 0, average: null, topArtists: [], byDecade: [] });
    });
  });
});
