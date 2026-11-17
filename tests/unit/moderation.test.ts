/**
 * Integration tests for reports, moderation and account deletion/export against the real
 * database. Throwaway rows only (@mod-test.invalid, random MBIDs), removed afterwards.
 * Skipped without DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import {
  buildDataExport,
  isWithinGrace,
  purgeDeletedAccounts,
  requestAccountDeletion,
  restoreAccount,
} from "@/lib/account/account";
import { createReport, listOpenReportGroups, resolveReports } from "@/lib/moderation/reports";
import {
  hideReview,
  recentAdminActions,
  removeComment,
  resetUserImage,
  restoreComment,
  setUserRole,
  suspendUser,
  unhideReview,
  unsuspendUser,
  type Moderator,
} from "@/lib/moderation/service";
import { getAlbumStats, getReviewPage, listAlbumReviews } from "@/lib/reviews/queries";
import { ReviewError, deleteReview, saveReview } from "@/lib/reviews/service";
import { addComment, listComments } from "@/lib/social/comments";
import { getDiscoverFeed } from "@/lib/social/feed";
import { followUser } from "@/lib/social/follows";

const { users, albums, artists, reports, comments, profiles, reviews } = schema;
const DOMAIN = "@mod-test.invalid";

describe.skipIf(!process.env.DATABASE_URL)("moderation and accounts", () => {
  const db = getDb();
  let owner: string;
  let admin: string;
  let author: string; // public member who writes the reviews
  let reader: string; // public member who reports
  let reader2: string;
  let priv: string; // private member
  let albumId: string;
  let artistId: string;
  let reviewId: string;
  let reviewSlug: string;
  let commentId: string;

  const mod = (id: string, role: Moderator["role"]): Moderator => ({ id, role });
  const ownerMod = () => mod(owner, "owner");
  const adminMod = () => mod(admin, "admin");
  const viewerOf = (id: string) => ({ id, isAdmin: false });

  const mk = async (name: string, over: Partial<typeof users.$inferInsert> = {}) =>
    (
      await db
        .insert(users)
        .values({ email: `${name}${DOMAIN}`, handle: `mod_${name}`, displayName: name, ...over })
        .returning({ id: users.id })
    )[0].id;

  const publish = (authorId: string, over = {}) =>
    saveReview(authorId, {
      albumId,
      title: null,
      body: "A written review.",
      rating: 8,
      clipTrackId: null,
      tags: [],
      status: "published",
      ...over,
    });

  beforeAll(async () => {
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    owner = await mk("owner", { role: "owner" });
    admin = await mk("admin", { role: "admin" });
    author = await mk("author");
    reader = await mk("reader");
    reader2 = await mk("reader2");
    priv = await mk("priv", { isPrivate: true });

    [{ id: artistId }] = await db
      .insert(artists)
      .values({ mbid: randomUUID(), name: "Mod Artist", slug: `mod-${randomUUID()}` })
      .returning({ id: artists.id });
    [{ id: albumId }] = await db
      .insert(albums)
      .values({ mbid: randomUUID(), title: "Mod Album", slug: "mod", artistId })
      .returning({ id: albums.id });
    await db.insert(schema.albumStats).values({ albumId });

    const saved = await publish(author);
    reviewId = saved.id;
    reviewSlug = saved.slug;
    await publish(reader, { rating: 6, body: "" });
    commentId = await addComment({ id: reader, isAdmin: false }, reviewId, "A comment to moderate");
  });

  afterAll(async () => {
    // Admin actions and reports outlive the users they mention, so remove this run's by target.
    const testUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%${DOMAIN}`));
    const targets = [...testUsers.map((u) => u.id), reviewId, commentId].filter(Boolean);
    if (targets.length) {
      await db.delete(schema.adminActions).where(inArray(schema.adminActions.targetId, targets));
      await db.delete(reports).where(inArray(reports.targetId, targets));
    }
    await db.delete(users).where(like(users.email, `%${DOMAIN}`));
    await db.delete(albums).where(eq(albums.id, albumId));
    await db.delete(artists).where(eq(artists.id, artistId));
    await db.$client.end();
  });

  describe("reports", () => {
    it("files a report, once per person per target", async () => {
      const input = {
        targetType: "review" as const,
        targetId: reviewId,
        reason: "spam" as const,
        details: null,
      };
      expect((await createReport({ id: reader, isAdmin: false }, input)).created).toBe(true);
      expect((await createReport({ id: reader, isAdmin: false }, input)).created).toBe(false);
      expect(
        (await createReport({ id: reader2, isAdmin: false }, { ...input, reason: "hate" })).created,
      ).toBe(true);
    });

    it("merges reports about the same target in the queue", async () => {
      const groups = await listOpenReportGroups();
      const g = groups.find((x) => x.targetId === reviewId)!;
      expect(g.count).toBe(2);
      expect(g.reasons.sort()).toEqual(["hate", "spam"]);
      expect(g.target).toMatchObject({ kind: "review", status: "published" });
    });

    it("can't report your own content or yourself", async () => {
      const own = { reason: "spam" as const, details: null };
      await expect(
        createReport(
          { id: author, isAdmin: false },
          { ...own, targetType: "review", targetId: reviewId },
        ),
      ).rejects.toMatchObject({ code: "invalid" });
      await expect(
        createReport(
          { id: author, isAdmin: false },
          { ...own, targetType: "user", targetId: author },
        ),
      ).rejects.toMatchObject({ code: "invalid" });
    });

    it("can't report what you can't see (private accounts don't leak)", async () => {
      const secret = await saveReview(priv, {
        albumId,
        title: null,
        body: "Private words",
        rating: 5,
        clipTrackId: null,
        tags: [],
        status: "published",
      });
      await expect(
        createReport(
          { id: reader, isAdmin: false },
          { targetType: "review", targetId: secret.id, reason: "spam", details: null },
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      // once the reader is an accepted follower it is visible, so reportable
      await db
        .insert(schema.follows)
        .values({ followerId: reader, followeeId: priv, status: "accepted" });
      await expect(
        createReport(
          { id: reader, isAdmin: false },
          { targetType: "review", targetId: secret.id, reason: "spam", details: "x" },
        ),
      ).resolves.toMatchObject({ created: true });
      await db.delete(schema.follows).where(eq(schema.follows.followerId, reader));
      await db.delete(reports).where(eq(reports.targetId, secret.id));
      await deleteReview(priv, secret.id); // keeps album_stats in step
      await db.delete(reviews).where(eq(reviews.id, secret.id));
    });

    it("resolving marks every open report on the target handled", async () => {
      const resolved = await resolveReports(admin, "review", reviewId, "dismissed");
      expect(resolved).toBe(2);
      expect((await listOpenReportGroups()).some((g) => g.targetId === reviewId)).toBe(false);
    });
  });

  describe("hiding reviews", () => {
    it("takes the review out of lists, pages and the average; the author can't undo it", async () => {
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 2, ratingSum: 14 });
      expect(await hideReview(adminMod(), reviewId, "spam")).toBe(true);

      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 1, ratingSum: 6 });
      const list = await listAlbumReviews({ albumId, viewer: null, sort: "recent", limit: 10 });
      expect(list.items.map((r) => r.id)).not.toContain(reviewId);
      expect((await getDiscoverFeed(null)).items.map((i) => i.id)).not.toContain(reviewId);
      expect(await getReviewPage("mod_author", reviewSlug, null)).toBeNull();
      expect(await getReviewPage("mod_author", reviewSlug, viewerOf(reader))).toBeNull();

      // ...but the author and admins can still open it (to see the notice / to moderate)
      expect(await getReviewPage("mod_author", reviewSlug, viewerOf(author))).not.toBeNull();
      expect(
        await getReviewPage("mod_author", reviewSlug, { id: admin, isAdmin: true }),
      ).not.toBeNull();

      await expect(
        publish(author, { reviewId, body: "I'm editing it back" }),
      ).rejects.toBeInstanceOf(ReviewError);
      expect(await deleteReview(author, reviewId)).toBe(false);
      const [row] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
      expect(row.status).toBe("hidden");
      expect(row.body).toBe("A written review.");
    });

    it("hiding twice does nothing; restoring brings it and its rating back", async () => {
      expect(await hideReview(adminMod(), reviewId)).toBe(false);
      expect(await unhideReview(adminMod(), reviewId)).toBe(true);
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 2, ratingSum: 14 });
      expect(await getReviewPage("mod_author", reviewSlug, null)).not.toBeNull();
    });

    it("members can't moderate", async () => {
      await expect(hideReview(mod(reader, "member"), reviewId)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(suspendUser(mod(reader, "member"), author)).rejects.toMatchObject({
        code: "forbidden",
      });
    });
  });

  describe("comments", () => {
    it("removal hides the comment; restoring brings it back", async () => {
      expect(await removeComment(adminMod(), commentId, "rude")).toBe(true);
      const hidden = await listComments(reviewId, author, viewerOf(reader2));
      expect(hidden.comments).toHaveLength(0);
      expect(await restoreComment(adminMod(), commentId)).toBe(true);
      expect((await listComments(reviewId, author, viewerOf(reader2))).comments).toHaveLength(1);
    });

    it("reports about a comment show its text in the queue", async () => {
      await createReport(
        { id: reader2, isAdmin: false },
        { targetType: "comment", targetId: commentId, reason: "harassment", details: null },
      );
      const g = (await listOpenReportGroups()).find((x) => x.targetId === commentId)!;
      expect(g.target).toMatchObject({ kind: "comment", body: "A comment to moderate" });
      await resolveReports(admin, "comment", commentId, "dismissed");
    });
  });

  describe("suspending accounts", () => {
    it("rules: not yourself, not the owner, admins can't suspend admins, the owner can", async () => {
      await expect(suspendUser(adminMod(), admin)).rejects.toMatchObject({ code: "invalid" });
      await expect(suspendUser(adminMod(), owner)).rejects.toMatchObject({ code: "forbidden" });
      const other = await mk("admin2", { role: "admin" });
      await expect(suspendUser(adminMod(), other)).rejects.toMatchObject({ code: "forbidden" });
      await suspendUser(ownerMod(), other);
      const [row] = await db.select().from(users).where(eq(users.id, other));
      expect(row.status).toBe("suspended");
    });

    it("a suspended account's content disappears and its ratings stop counting; unsuspending reverses it", async () => {
      await suspendUser(adminMod(), author, "spam");
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 1, ratingSum: 6 });
      expect(await getReviewPage("mod_author", reviewSlug, null)).toBeNull();
      expect((await getDiscoverFeed(null)).items.map((i) => i.author.handle)).not.toContain(
        "mod_author",
      );
      await expect(followUser(reader, author)).rejects.toMatchObject({ code: "not_found" });

      await unsuspendUser(adminMod(), author);
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 2, ratingSum: 14 });
      expect(await getReviewPage("mod_author", reviewSlug, null)).not.toBeNull();
    });

    it("only the owner can change roles, and never the owner's", async () => {
      await expect(setUserRole(adminMod(), reader, "admin")).rejects.toMatchObject({
        code: "forbidden",
      });
      await setUserRole(ownerMod(), reader, "admin");
      expect((await db.select().from(users).where(eq(users.id, reader)))[0].role).toBe("admin");
      await setUserRole(ownerMod(), reader, "member");
      await expect(setUserRole(ownerMod(), owner, "member")).rejects.toMatchObject({
        code: "forbidden",
      });
    });

    it("resets an avatar and a banner to the default", async () => {
      await db.update(users).set({ image: "avatars/x/y.webp" }).where(eq(users.id, reader2));
      await db
        .insert(profiles)
        .values({ userId: reader2, bannerKey: "banners/x/y.webp" })
        .onConflictDoNothing();
      await db
        .update(profiles)
        .set({ bannerKey: "banners/x/y.webp" })
        .where(eq(profiles.userId, reader2));
      await resetUserImage(adminMod(), reader2, "avatar");
      await resetUserImage(adminMod(), reader2, "banner");
      expect((await db.select().from(users).where(eq(users.id, reader2)))[0].image).toBeNull();
      expect(
        (await db.select().from(profiles).where(eq(profiles.userId, reader2)))[0].bannerKey,
      ).toBeNull();
    });

    it("every admin action is written to the activity log", async () => {
      const actions = (await recentAdminActions(100)).map((a) => a.action);
      for (const expected of [
        "hide_review",
        "unhide_review",
        "remove_comment",
        "restore_comment",
        "suspend_user",
        "unsuspend_user",
        "make_admin",
        "reset_avatar",
      ]) {
        expect(actions).toContain(expected);
      }
    });
  });

  describe("account export", () => {
    it("includes everything the user owns, drafts included, and nothing of other people's private data", async () => {
      const dAlbum = (
        await db
          .insert(albums)
          .values({ mbid: randomUUID(), title: "Draft Album", slug: "draft", artistId })
          .returning({ id: albums.id })
      )[0].id;
      await saveReview(author, {
        albumId: dAlbum,
        title: "Unfinished",
        body: "Secret draft text",
        rating: 4,
        clipTrackId: null,
        tags: ["wip"],
        status: "draft",
      });
      const data = await buildDataExport(author);
      expect(data!.account.email).toBe(`author${DOMAIN}`);
      expect(data!.reviews.map((r) => r.title ?? r.album)).toEqual(
        expect.arrayContaining(["Unfinished"]),
      );
      const draft = data!.reviews.find((r) => r.title === "Unfinished")!;
      expect(draft).toMatchObject({ status: "draft", body: "Secret draft text", tags: ["wip"] });
      expect(data!.followers).toBeInstanceOf(Array);
      const json = JSON.stringify(data);
      expect(json).not.toContain(`reader${DOMAIN}`); // other users' emails never appear
      await db.delete(reviews).where(eq(reviews.albumId, dAlbum));
      await db.delete(albums).where(eq(albums.id, dAlbum));
    });

    it("returns null for an unknown user", async () => {
      expect(await buildDataExport(randomUUID())).toBeNull();
    });
  });

  describe("account deletion", () => {
    let victim: string;
    let victimReview: string;
    let victimComment: string;

    beforeAll(async () => {
      victim = await mk("victim");
      victimReview = (await publish(victim, { rating: 10, body: "Soon gone." })).id;
      victimComment = await addComment({ id: victim, isAdmin: false }, reviewId, "Victim was here");
    });

    it("hides the account at once and removes its rating from the average", async () => {
      const before = await getAlbumStats(albumId);
      await requestAccountDeletion(victim);
      const after = await getAlbumStats(albumId);
      expect(after.ratingCount).toBe(before.ratingCount - 1);
      expect(await getReviewPage("mod_victim", "mod-album", null)).toBeNull();
      expect(
        (await listComments(reviewId, author, viewerOf(reader))).comments.map((c) => c.id),
      ).not.toContain(victimComment);
    });

    it("can be restored within the grace period, bringing everything back", async () => {
      expect(await restoreAccount(victim)).toBe(true);
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 3 });
      expect(
        (await listComments(reviewId, author, viewerOf(reader))).comments.map((c) => c.id),
      ).toContain(victimComment);
    });

    it("restoring an account that isn't deleted does nothing", async () => {
      expect(await restoreAccount(victim)).toBe(false);
    });

    it("the grace period is 30 days", () => {
      const day = 24 * 60 * 60 * 1000;
      const deleted = new Date("2030-01-01T00:00:00Z");
      expect(isWithinGrace(deleted, new Date(deleted.getTime() + 29 * day))).toBe(true);
      expect(isWithinGrace(deleted, new Date(deleted.getTime() + 31 * day))).toBe(false);
    });

    it("is not purged early, and can't be restored or kept after the window", async () => {
      await requestAccountDeletion(victim);
      const day = 24 * 60 * 60 * 1000;
      expect(await purgeDeletedAccounts(new Date(Date.now() + 10 * day))).toBe(0);
      expect((await db.select().from(users).where(eq(users.id, victim))).length).toBe(1);
      expect(await restoreAccount(victim, new Date(Date.now() + 31 * day))).toBe(false);
    });

    it("purges after 30 days: everything cascades away and the album stats are corrected", async () => {
      const day = 24 * 60 * 60 * 1000;
      const purged = await purgeDeletedAccounts(new Date(Date.now() + 31 * day));
      expect(purged).toBeGreaterThanOrEqual(1);
      expect(await db.select().from(users).where(eq(users.id, victim))).toHaveLength(0);
      expect(await db.select().from(reviews).where(eq(reviews.id, victimReview))).toHaveLength(0);
      expect(await db.select().from(comments).where(eq(comments.id, victimComment))).toHaveLength(
        0,
      );
      expect(await getAlbumStats(albumId)).toMatchObject({ ratingCount: 2, ratingSum: 14 });
    });

    it("never purges accounts that aren't deleted", async () => {
      const day = 24 * 60 * 60 * 1000;
      await purgeDeletedAccounts(new Date(Date.now() + 365 * day));
      const alive = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, [author, reader, admin, owner])));
      expect(alive).toHaveLength(4);
    });

    it("the owner account can't be deleted", async () => {
      await expect(requestAccountDeletion(owner)).rejects.toThrow(/owner/i);
      expect((await db.select().from(users).where(eq(users.id, owner)))[0].deletedAt).toBeNull();
    });
  });
});
