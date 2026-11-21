/**
 * Integration tests for the social layer against the real database: follows (public and
 * private), blocks, notifications, comments, hearts, the feed, discover and the album page's
 * "people you follow" data. Throwaway rows only (@soc-test.invalid and random MBIDs), removed
 * afterwards. Skipped without DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { getFollowingActivity } from "@/lib/social/album-activity";
import { blockUser, unblockUser } from "@/lib/social/blocks";
import { hasMuted, listMuted, muteUser, unmuteUser } from "@/lib/social/mutes";
import { addComment, deleteComment, editComment, listComments } from "@/lib/social/comments";
import { getDiscoverFeed, getFollowingFeed, getSuggestedReviewers } from "@/lib/social/feed";
import {
  followUser,
  getFollowState,
  listFollowers,
  respondToFollowRequest,
  SocialError,
  unfollowUser,
} from "@/lib/social/follows";
import { listNotifications, unreadCount, markAllRead } from "@/lib/social/notifications";
import { checkRateLimit } from "@/lib/social/ratelimit";
import { getReviewHearts, toggleHeart } from "@/lib/social/reactions";
import { listAlbumReviews } from "@/lib/reviews/queries";
import { addToQueue, removeFromQueue } from "@/lib/queue/service";
import { getFollowingStream } from "@/lib/social/shelf-feed";
import { saveReview, setQuickRating } from "@/lib/reviews/service";

const { users, albums, artists, reviews, notifications, queueItems } = schema;
const DOMAIN = "@soc-test.invalid";

const asActor = (id: string, isAdmin = false) => ({ id, isAdmin });
const viewerOf = (id: string) => ({ id, isAdmin: false });

describe.skipIf(!process.env.DATABASE_URL)("social layer", () => {
  const db = getDb();
  let alice: string; // public, the main viewer
  let bob: string; // public, reviews things
  let carol: string; // private
  let dave: string; // public, never followed
  let albumId: string;
  let albumId2: string;
  let artistId: string;
  let bobReview: string;
  let carolReview: string;

  const mk = async (name: string, over: Partial<typeof users.$inferInsert> = {}) =>
    (
      await db
        .insert(users)
        .values({ email: `${name}${DOMAIN}`, handle: `soc_${name}`, displayName: name, ...over })
        .returning({ id: users.id })
    )[0].id;

  const publish = (authorId: string, album: string, over = {}) =>
    saveReview(authorId, {
      albumId: album,
      title: null,
      body: "",
      rating: null,
      tags: [],
      status: "published",
      ...over,
    });

  const notesFor = async (userId: string) =>
    (await db.select().from(notifications).where(eq(notifications.recipientId, userId))).map(
      (n) => n.type,
    );

  beforeAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    [alice, bob, dave] = [await mk("alice"), await mk("bob"), await mk("dave")];
    carol = await mk("carol", { isPrivate: true });

    [{ id: artistId }] = await db
      .insert(artists)
      .values({ mbid: randomUUID(), name: "Soc Artist", slug: `soc-${randomUUID()}` })
      .returning({ id: artists.id });
    const mkAlbum = async (title: string) => {
      const [a] = await db
        .insert(albums)
        .values({ mbid: randomUUID(), title, slug: "soc", artistId })
        .returning({ id: albums.id });
      await db.insert(schema.albumStats).values({ albumId: a.id });
      return a.id;
    };
    albumId = await mkAlbum("Social Album");
    albumId2 = await mkAlbum("Second Social Album");
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    await db.delete(albums).where(inArray(albums.id, [albumId, albumId2]));
    await db.delete(artists).where(eq(artists.id, artistId));
    await db.$client.end();
  });

  describe("rate limiting", () => {
    it("allows up to the limit, then refuses until the window ends", async () => {
      const id = randomUUID();
      const now = new Date("2030-01-01T12:00:10Z");
      for (let i = 0; i < 10; i++) expect((await checkRateLimit(id, "comment", now)).ok).toBe(true);
      const blocked = await checkRateLimit(id, "comment", now);
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.retryAfterSec).toBe(50);
      expect((await checkRateLimit(id, "comment", new Date("2030-01-01T12:01:00Z"))).ok).toBe(true);
    });

    it("limits each user and each action separately", async () => {
      const a = randomUUID();
      const b = randomUUID();
      const now = new Date("2030-01-01T12:00:10Z");
      for (let i = 0; i < 11; i++) await checkRateLimit(a, "comment", now);
      expect((await checkRateLimit(a, "comment", now)).ok).toBe(false);
      expect((await checkRateLimit(b, "comment", now)).ok).toBe(true);
      expect((await checkRateLimit(a, "reaction", now)).ok).toBe(true);
    });
  });

  describe("following", () => {
    it("following a public account is immediate and notifies them", async () => {
      expect(await followUser(alice, bob)).toBe("accepted");
      expect(await getFollowState(alice, bob)).toBe("accepted");
      expect(await notesFor(bob)).toEqual(["follow"]);
    });

    it("following twice changes nothing and doesn't notify twice", async () => {
      expect(await followUser(alice, bob)).toBe("accepted");
      expect(await notesFor(bob)).toEqual(["follow"]);
    });

    it("can't follow yourself", async () => {
      await expect(followUser(alice, alice)).rejects.toBeInstanceOf(SocialError);
    });

    it("following a private account creates a pending request", async () => {
      expect(await followUser(alice, carol)).toBe("pending");
      expect(await getFollowState(alice, carol)).toBe("pending");
      expect(await notesFor(carol)).toEqual(["follow_request"]);
    });

    it("a pending request is not a follow: it shows no content and isn't in follower lists", async () => {
      const followers = await listFollowers(carol, viewerOf(alice));
      expect(followers.items).toHaveLength(0);
    });

    it("accepting grants access, clears the request notification and tells the requester", async () => {
      expect(await respondToFollowRequest(carol, alice, true)).toBe(true);
      expect(await getFollowState(alice, carol)).toBe("accepted");
      expect(await notesFor(carol)).toEqual([]);
      expect(await notesFor(alice)).toEqual(["follow_accepted"]);
      expect(await respondToFollowRequest(carol, alice, true)).toBe(false); // nothing pending now
    });

    it("declining deletes the request, silently", async () => {
      await followUser(dave, carol);
      expect(await respondToFollowRequest(carol, dave, false)).toBe(true);
      expect(await getFollowState(dave, carol)).toBeNull();
      expect(await notesFor(dave)).toEqual([]);
    });

    it("only the account owner can answer a request", async () => {
      await followUser(dave, carol);
      expect(await respondToFollowRequest(bob, dave, true)).toBe(false);
      expect(await getFollowState(dave, carol)).toBe("pending");
      await unfollowUser(dave, carol); // withdraw
      expect(await getFollowState(dave, carol)).toBeNull();
      expect((await notesFor(carol)).includes("follow_request")).toBe(false);
    });

    it("lists followers, hiding suspended accounts", async () => {
      const ghost = await mk("ghost", { status: "suspended" });
      await followUser(ghost, bob);
      const names = (await listFollowers(bob, viewerOf(dave))).items.map((p) => p.handle);
      expect(names).toEqual(["soc_alice"]);
      await unfollowUser(ghost, bob);
    });

    it("unfollowing removes the follow and its notification", async () => {
      const erin = await mk("erin");
      await followUser(erin, bob);
      expect((await notesFor(bob)).filter((t) => t === "follow")).toHaveLength(2);
      await unfollowUser(erin, bob);
      expect((await notesFor(bob)).filter((t) => t === "follow")).toHaveLength(1);
    });
  });

  describe("blocking", () => {
    it("removes follows in both directions and the notifications between the two", async () => {
      const x = await mk("blk_x");
      const y = await mk("blk_y");
      await followUser(x, y);
      await followUser(y, x);
      expect((await notesFor(y)).length).toBeGreaterThan(0);

      await blockUser(x, y);
      expect(await getFollowState(x, y)).toBeNull();
      expect(await getFollowState(y, x)).toBeNull();
      expect(await notesFor(y)).toEqual([]);
      expect(await notesFor(x)).toEqual([]);
    });

    it("a blocked user can't follow the blocker, and it looks like the account doesn't exist", async () => {
      const x = await mk("blk_a");
      const y = await mk("blk_b");
      await blockUser(x, y);
      await expect(followUser(y, x)).rejects.toMatchObject({ code: "not_found" });
      await expect(followUser(x, y)).rejects.toMatchObject({ code: "not_found" });
      await unblockUser(x, y);
      expect(await followUser(y, x)).toBe("accepted");
    });

    it("blocked people don't appear in each other's lists and generate no notifications", async () => {
      const x = await mk("blk_c");
      const y = await mk("blk_d");
      await followUser(y, x);
      await blockUser(x, y);
      expect((await listFollowers(x, viewerOf(x))).items).toHaveLength(0);
      const [row] = await db.select().from(users).where(eq(users.id, y));
      expect(row.id).toBe(y);
      expect(await notesFor(x)).toEqual([]);
    });
  });

  describe("comments", () => {
    beforeAll(async () => {
      bobReview = (await publish(bob, albumId, { body: "Bob's take.", rating: 8 })).id;
      carolReview = (await publish(carol, albumId, { body: "Carol's secret take.", rating: 10 }))
        .id;
    });

    it("adds a comment and notifies the review's author", async () => {
      const id = await addComment(asActor(alice), bobReview, "  Great review!  ");
      const { comments } = await listComments(bobReview, bob, viewerOf(alice));
      expect(comments.map((c) => c.body)).toEqual(["Great review!"]);
      expect(comments[0].id).toBe(id);
      expect(await notesFor(bob)).toContain("comment");
    });

    it("commenting on your own review doesn't notify you", async () => {
      const before = (await notesFor(bob)).length;
      await addComment(asActor(bob), bobReview, "Thanks everyone");
      expect((await notesFor(bob)).length).toBe(before);
    });

    it("replies are one level deep and notify the parent's author", async () => {
      const { comments } = await listComments(bobReview, bob, viewerOf(alice));
      const top = comments.find((c) => c.body === "Great review!")!;
      const replyId = await addComment(asActor(bob), bobReview, "Glad you liked it", top.id);
      expect(await notesFor(alice)).toContain("reply");
      await expect(addComment(asActor(alice), bobReview, "nested", replyId)).rejects.toMatchObject({
        code: "invalid",
      });
      const tree = await listComments(bobReview, bob, viewerOf(alice));
      expect(tree.comments.find((c) => c.id === top.id)!.replies.map((r) => r.body)).toEqual([
        "Glad you liked it",
      ]);
      expect(tree.total).toBe(3);
    });

    it("rejects empty and over-long comments", async () => {
      await expect(addComment(asActor(alice), bobReview, "   ")).rejects.toMatchObject({
        code: "invalid",
      });
      await expect(addComment(asActor(alice), bobReview, "x".repeat(2001))).rejects.toMatchObject({
        code: "invalid",
      });
    });

    it("can't comment on a review you aren't allowed to see (private, not following)", async () => {
      await expect(addComment(asActor(dave), carolReview, "hi")).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("accepted followers of a private account can comment", async () => {
      await expect(addComment(asActor(alice), carolReview, "Love it")).resolves.toBeTruthy();
    });

    it("hides comments by private accounts from people who can't see them", async () => {
      await addComment(asActor(carol), bobReview, "Carol was here");
      const asAlice = await listComments(bobReview, bob, viewerOf(alice));
      const asDave = await listComments(bobReview, bob, viewerOf(dave));
      expect(asAlice.comments.map((c) => c.body)).toContain("Carol was here");
      expect(asDave.comments.map((c) => c.body)).not.toContain("Carol was here");
    });

    it("only the author can edit; edits are marked", async () => {
      const id = await addComment(asActor(dave), bobReview, "Typo hree");
      await expect(editComment(alice, id, "hacked")).rejects.toMatchObject({ code: "not_found" });
      await editComment(dave, id, "Typo here");
      const { comments } = await listComments(bobReview, bob, viewerOf(dave));
      const c = comments.find((x) => x.id === id)!;
      expect(c.body).toBe("Typo here");
      expect(c.editedAt).not.toBeNull();
      expect(c.canEdit).toBe(true);
    });

    it("the comment's author, the review's author and admins can delete; others can't", async () => {
      const id = await addComment(asActor(dave), bobReview, "Delete me");
      await expect(deleteComment(asActor(alice), id)).rejects.toMatchObject({ code: "forbidden" });
      expect(await deleteComment(asActor(bob), id)).toBe(true); // review's author
      expect(await deleteComment(asActor(bob), id)).toBe(false); // already gone

      const id2 = await addComment(asActor(dave), bobReview, "Delete me too");
      expect(await deleteComment(asActor(dave), id2)).toBe(true); // own
      const id3 = await addComment(asActor(dave), bobReview, "And me");
      expect(await deleteComment(asActor(alice, true), id3)).toBe(true); // admin
    });

    it("a deleted comment with replies stays as a placeholder; one without disappears", async () => {
      const top = await addComment(asActor(alice), bobReview, "Parent");
      await addComment(asActor(bob), bobReview, "Child", top);
      await deleteComment(asActor(alice), top);
      const { comments } = await listComments(bobReview, bob, viewerOf(alice));
      const parent = comments.find((c) => c.id === top)!;
      expect(parent.deleted).toBe(true);
      expect(parent.body).toBe("");
      expect(parent.replies.map((r) => r.body)).toEqual(["Child"]);
    });

    it("stops a blocked user from replying to the blocker", async () => {
      const top = await addComment(asActor(alice), bobReview, "Another top-level");
      await blockUser(alice, dave);
      await expect(addComment(asActor(dave), bobReview, "reply", top)).rejects.toMatchObject({
        code: "not_found",
      });
      await unblockUser(alice, dave);
    });
  });

  describe("hearts", () => {
    it("toggles on and off, counts, and notifies once", async () => {
      expect(await toggleHeart(asActor(alice), "review", bobReview)).toEqual({
        hearted: true,
        count: 1,
      });
      expect((await notesFor(bob)).filter((t) => t === "reaction")).toHaveLength(1);
      expect(await toggleHeart(asActor(dave), "review", bobReview)).toEqual({
        hearted: true,
        count: 2,
      });
      expect(await toggleHeart(asActor(alice), "review", bobReview)).toEqual({
        hearted: false,
        count: 1,
      });
      expect((await notesFor(bob)).filter((t) => t === "reaction")).toHaveLength(1); // dave's remains
      const map = await getReviewHearts([bobReview], dave);
      expect(map.get(bobReview)).toEqual({ count: 1, hearted: true });
    });

    it("can't heart what you can't see", async () => {
      await expect(toggleHeart(asActor(dave), "review", carolReview)).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("hearts comments too", async () => {
      const id = await addComment(asActor(dave), bobReview, "Heart this");
      expect(await toggleHeart(asActor(alice), "comment", id)).toEqual({ hearted: true, count: 1 });
      const { comments } = await listComments(bobReview, bob, viewerOf(alice));
      const c = comments.find((x) => x.id === id)!;
      expect([c.hearts, c.hearted]).toEqual([1, true]);
    });
  });

  describe("notifications", () => {
    it("lists, counts unread, and marks everything read", async () => {
      expect(await unreadCount(bob)).toBeGreaterThan(0);
      const { items } = await listNotifications(bob);
      expect(items.length).toBeGreaterThan(0);
      expect(items.find((i) => i.type === "comment")?.href).toMatch(/^\/u\/soc_bob\/.+#comment-/);
      expect(items.find((i) => i.type === "follow")?.href).toMatch(/^\/u\/soc_/);
      await markAllRead(bob);
      expect(await unreadCount(bob)).toBe(0);
    });

    it("someone who is blocked generates nothing", async () => {
      const before = (await notesFor(alice)).length;
      await blockUser(alice, dave);
      const id = await addComment(asActor(dave), bobReview, "Hello?").catch(() => null);
      expect(id).toBeTruthy(); // can comment on bob's review...
      expect((await notesFor(alice)).length).toBe(before); // ...but alice is not notified of anything
      await unblockUser(alice, dave);
    });
  });

  describe("feeds", () => {
    it("the following feed shows followed people's published reviews, newest first", async () => {
      const feed = await getFollowingFeed(viewerOf(alice));
      const ids = feed.items.map((i) => i.id);
      expect(ids).toContain(bobReview);
      expect(ids).toContain(carolReview); // alice is an accepted follower of private carol
    });

    it("does not include people you don't follow, drafts, or pending private accounts", async () => {
      await publish(dave, albumId, { body: "Dave's review", rating: 6 });
      const draftAuthor = await mk("drafty");
      await followUser(alice, draftAuthor);
      await publish(draftAuthor, albumId2, { body: "unfinished", status: "draft" });

      const feed = await getFollowingFeed(viewerOf(alice));
      const authors = feed.items.map((i) => i.author.handle);
      expect(authors).not.toContain("soc_dave");
      expect(authors).not.toContain("soc_drafty");

      // dave follows carol only as pending: carol's reviews must not reach his feed
      await followUser(dave, bob);
      await followUser(dave, carol);
      const daveFeed = await getFollowingFeed(viewerOf(dave));
      expect(daveFeed.items.map((i) => i.id)).toContain(bobReview);
      expect(daveFeed.items.map((i) => i.id)).not.toContain(carolReview);
      await unfollowUser(dave, carol);
    });

    it("includes rating-only logs, as compact entries (empty body)", async () => {
      const logger = await mk("logger");
      await followUser(alice, logger);
      await setQuickRating(logger, albumId2, 7);
      const item = (await getFollowingFeed(viewerOf(alice))).items.find(
        (i) => i.author.handle === "soc_logger",
      );
      expect(item).toMatchObject({ rating: 7, body: "" });
    });

    it("hides a muted author from the feeds, quietly, and shows them again after unmuting", async () => {
      const inFeed = async () => (await getFollowingFeed(viewerOf(alice))).items.map((i) => i.id);
      const inDiscover = async () =>
        (await getDiscoverFeed(viewerOf(alice))).items.map((i) => i.id);
      expect(await inFeed()).toContain(bobReview);

      const before = (await notesFor(bob)).length;
      await muteUser(alice, bob);
      expect(await hasMuted(alice, bob)).toBe(true);
      expect((await listMuted(alice)).map((p) => p.id)).toEqual([bob]);
      expect(await inFeed()).not.toContain(bobReview);
      expect(await inDiscover()).not.toContain(bobReview);
      // Still following, and bob isn't told.
      expect(await getFollowState(alice, bob)).toBe("accepted");
      expect((await notesFor(bob)).length).toBe(before);
      // On an album page they're left out of "people you follow" and of the popular/recent lists.
      const activity = await getFollowingActivity(albumId, viewerOf(alice));
      expect(activity.people.map((p) => p.userId)).not.toContain(bob);
      expect(
        (
          await listAlbumReviews({
            albumId,
            viewer: viewerOf(alice),
            sort: "recent",
            limit: 10,
            followingOnly: true,
          })
        ).items.map((i) => i.id),
      ).not.toContain(bobReview);
      for (const sort of ["popular", "recent"] as const) {
        const list = await listAlbumReviews({ albumId, viewer: viewerOf(alice), sort, limit: 10 });
        expect(list.items.map((i) => i.id)).not.toContain(bobReview);
      }
      // Mutes are one-way: bob's own feed is unaffected by alice muting him.
      expect(await hasMuted(bob, alice)).toBe(false);

      await unmuteUser(alice, bob);
      expect(await hasMuted(alice, bob)).toBe(false);
      expect(await inFeed()).toContain(bobReview);
      expect(
        (await getFollowingActivity(albumId, viewerOf(alice))).people.map((p) => p.userId),
      ).toContain(bob);
      expect(
        (
          await listAlbumReviews({ albumId, viewer: viewerOf(alice), sort: "recent", limit: 10 })
        ).items.map((i) => i.id),
      ).toContain(bobReview);
    });

    it("shows albums people add to In rotation in the following feed", async () => {
      const rotation = async (viewerId: string) =>
        (await getFollowingStream(viewerOf(viewerId))).entries
          .filter((e) => e.kind === "rotation")
          .map((e) =>
            e.kind === "rotation" ? `${e.rotation.author.handle}:${e.rotation.album.mbid}` : "",
          );
      const [album] = await db
        .select({ mbid: albums.mbid })
        .from(albums)
        .where(eq(albums.id, albumId2));
      const entry = `soc_bob:${album.mbid}`;

      expect(await rotation(alice)).not.toContain(entry);
      expect(await addToQueue(bob, albumId2, "heard good things")).toBe("added");
      expect(await rotation(alice)).toContain(entry);
      // Not shown to someone who doesn't follow bob, but shown to bob himself.
      expect(await rotation(carol)).not.toContain(entry);
      expect(await rotation(bob)).toContain(entry);
      // Muting hides it.
      await muteUser(alice, bob);
      expect(await rotation(alice)).not.toContain(entry);
      await unmuteUser(alice, bob);
      // Taking it out of the rotation takes it off the feed.
      await removeFromQueue(bob, albumId2);
      expect(await rotation(alice)).not.toContain(entry);
    });

    it("can't mute yourself", async () => {
      await expect(muteUser(alice, alice)).rejects.toBeInstanceOf(SocialError);
    });

    it("hides a blocked author from the feed", async () => {
      await blockUser(alice, bob);
      expect((await getFollowingFeed(viewerOf(alice))).items.map((i) => i.id)).not.toContain(
        bobReview,
      );
      await unblockUser(alice, bob);
      await followUser(alice, bob);
    });

    it("paginates with a cursor without repeats", async () => {
      const first = await getFollowingFeed(viewerOf(alice), undefined);
      const all = new Set(first.items.map((i) => i.id));
      expect(all.size).toBe(first.items.length);
      if (first.nextCursor) {
        const second = await getFollowingFeed(viewerOf(alice), first.nextCursor);
        for (const i of second.items) expect(all.has(i.id)).toBe(false);
      }
    });

    it("discover shows written reviews from public accounts only", async () => {
      const discover = await getDiscoverFeed(viewerOf(alice));
      const handles = discover.items.map((i) => i.author.handle);
      expect(handles).toContain("soc_bob");
      expect(handles).not.toContain("soc_carol"); // private, even though alice follows her
      expect(discover.items.every((i) => i.body !== "")).toBe(true);
      const anon = await getDiscoverFeed(null);
      expect(anon.items.map((i) => i.author.handle)).not.toContain("soc_carol");
    });

    it("suggests public reviewers you don't follow yet, never yourself or private accounts", async () => {
      const suggestions = (await getSuggestedReviewers(viewerOf(alice), 50)).map((s) => s.handle);
      expect(suggestions).not.toContain("soc_alice");
      expect(suggestions).not.toContain("soc_carol");
      expect(suggestions).not.toContain("soc_bob"); // already followed
      expect(suggestions).toContain("soc_dave");
    });
  });

  describe("album page: people you follow", () => {
    it("shows followed users' stars and reviews, the following average and counts", async () => {
      const activity = await getFollowingActivity(albumId, viewerOf(alice));
      const byHandle = new Map(activity.people.map((p) => [p.handle, p]));
      expect(byHandle.get("soc_bob")).toMatchObject({ kind: "log", rating: 8, hasBody: true });
      expect(byHandle.get("soc_carol")).toMatchObject({ kind: "log", rating: 10, hasBody: true });
      expect(byHandle.has("soc_dave")).toBe(false); // alice doesn't follow dave
      expect(activity.listened).toBe(2);
      expect(activity.average).toEqual({ sum: 18, count: 2 });
    });

    it("never shows a private account the viewer doesn't follow", async () => {
      const asDave = await getFollowingActivity(albumId, viewerOf(dave)); // dave: bob only (carol declined)
      expect(asDave.people.map((p) => p.handle)).toEqual(["soc_bob"]);
      expect(asDave.average).toEqual({ sum: 8, count: 1 });
      // A pending request doesn't reveal anything either.
      await followUser(dave, carol);
      expect(
        (await getFollowingActivity(albumId, viewerOf(dave))).people.map((p) => p.handle),
      ).toEqual(["soc_bob"]);
      await unfollowUser(dave, carol);
    });

    it("is empty for signed-out viewers and for people who follow nobody", async () => {
      expect((await getFollowingActivity(albumId, null)).people).toEqual([]);
      const loner = await mk("loner");
      expect((await getFollowingActivity(albumId, viewerOf(loner))).people).toEqual([]);
    });

    it("distinguishes zero stars from no rating, and rating-only logs from reviews", async () => {
      const zero = await mk("zero");
      const none = await mk("none");
      const viewer = await mk("watcher");
      await followUser(viewer, zero);
      await followUser(viewer, none);
      await setQuickRating(zero, albumId, 0);
      await setQuickRating(none, albumId, null);
      const people = new Map(
        (await getFollowingActivity(albumId, viewerOf(viewer))).people.map((p) => [p.handle, p]),
      );
      expect(people.get("soc_zero")).toMatchObject({ rating: 0, hasBody: false });
      expect(people.get("soc_none")).toMatchObject({ rating: null, hasBody: false });
      expect((await getFollowingActivity(albumId, viewerOf(viewer))).average).toEqual({
        sum: 0,
        count: 1,
      });
    });

    it("lists queue-only people last, without stars, and not people who also logged it", async () => {
      const queuer = await mk("queuer");
      const viewer = await mk("watcher2");
      await followUser(viewer, queuer);
      await followUser(viewer, bob);
      await db.insert(queueItems).values([
        { ownerId: queuer, albumId },
        { ownerId: bob, albumId }, // bob has reviewed it: shown once, as a log
      ]);
      const activity = await getFollowingActivity(albumId, viewerOf(viewer));
      expect(activity.people.map((p) => [p.handle, p.kind])).toEqual([
        ["soc_bob", "log"],
        ["soc_queuer", "queue"],
      ]);
      expect(activity.inQueue).toBe(1);
      await db.delete(queueItems).where(and(eq(queueItems.albumId, albumId)));
    });

    it("a blocked user disappears from the strip", async () => {
      await blockUser(alice, bob);
      expect(
        (await getFollowingActivity(albumId, viewerOf(alice))).people.map((p) => p.handle),
      ).not.toContain("soc_bob");
      await unblockUser(alice, bob);
    });
  });

  it("leaves published reviews of other albums untouched by all of the above", async () => {
    const rows = await db.select().from(reviews).where(eq(reviews.authorId, bob));
    expect(rows.every((r) => r.deletedAt === null)).toBe(true);
  });
});
