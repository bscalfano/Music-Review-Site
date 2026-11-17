import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { recomputeAlbumStats, recomputeStatsForUser } from "@/lib/albums/stats";
import { bannerSmallKey, REVIEW_IMAGE_PREFIX } from "@/lib/images/process";
import { getStorage } from "@/lib/storage/r2";

const {
  users,
  profiles,
  reviews,
  tags,
  reviewTags,
  comments,
  follows,
  blocks,
  favoriteAlbums,
  albums,
  artists,
  reactions,
  lists,
  listItems,
  queueItems,
} = schema;

/** How long a deleted account can still be restored by signing in again. */
export const DELETION_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isWithinGrace = (deletedAt: Date, now = new Date()) =>
  now.getTime() - deletedAt.getTime() < DELETION_GRACE_DAYS * DAY_MS;

/**
 * Everything the site stores about a user, as plain JSON (GDPR-style "download my data").
 * Includes drafts and private content, since it's all theirs. Other people's data is limited to
 * their public handles.
 */
export async function buildDataExport(userId: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));

  const [
    myReviews,
    myComments,
    followingRows,
    followerRows,
    blockedRows,
    favorites,
    hearts,
    myLists,
    queue,
  ] = await Promise.all([
    db
      .select({
        id: reviews.id,
        slug: reviews.slug,
        album: albums.title,
        artist: artists.name,
        albumMbid: albums.mbid,
        title: reviews.title,
        body: reviews.body,
        rating: reviews.rating,
        status: reviews.status,
        publishedAt: reviews.publishedAt,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        deletedAt: reviews.deletedAt,
      })
      .from(reviews)
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .innerJoin(artists, eq(albums.artistId, artists.id))
      .where(eq(reviews.authorId, userId)),
    db
      .select({
        id: comments.id,
        reviewId: comments.reviewId,
        parentId: comments.parentId,
        body: comments.body,
        createdAt: comments.createdAt,
        editedAt: comments.editedAt,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .where(eq(comments.authorId, userId)),
    db
      .select({ handle: users.handle, status: follows.status, since: follows.createdAt })
      .from(follows)
      .innerJoin(users, eq(follows.followeeId, users.id))
      .where(eq(follows.followerId, userId)),
    db
      .select({ handle: users.handle, status: follows.status, since: follows.createdAt })
      .from(follows)
      .innerJoin(users, eq(follows.followerId, users.id))
      .where(eq(follows.followeeId, userId)),
    db
      .select({ handle: users.handle, since: blocks.createdAt })
      .from(blocks)
      .innerJoin(users, eq(blocks.blockedId, users.id))
      .where(eq(blocks.blockerId, userId)),
    db
      .select({ position: favoriteAlbums.position, album: albums.title, artist: artists.name })
      .from(favoriteAlbums)
      .innerJoin(albums, eq(favoriteAlbums.albumId, albums.id))
      .innerJoin(artists, eq(albums.artistId, artists.id))
      .where(eq(favoriteAlbums.userId, userId)),
    db
      .select({
        targetType: reactions.targetType,
        targetId: reactions.targetId,
        createdAt: reactions.createdAt,
      })
      .from(reactions)
      .where(eq(reactions.userId, userId)),
    db.select().from(lists).where(eq(lists.authorId, userId)),
    db
      .select({
        album: albums.title,
        artist: artists.name,
        status: queueItems.status,
        note: queueItems.note,
        createdAt: queueItems.createdAt,
      })
      .from(queueItems)
      .innerJoin(albums, eq(queueItems.albumId, albums.id))
      .innerJoin(artists, eq(albums.artistId, artists.id))
      .where(eq(queueItems.ownerId, userId)),
  ]);

  const reviewIds = myReviews.map((r) => r.id);
  const tagRows = reviewIds.length
    ? await db
        .select({ reviewId: reviewTags.reviewId, name: tags.name })
        .from(reviewTags)
        .innerJoin(tags, eq(reviewTags.tagId, tags.id))
        .where(inArray(reviewTags.reviewId, reviewIds))
    : [];
  const listIds = myLists.map((l) => l.id);
  const items = listIds.length
    ? await db.select().from(listItems).where(inArray(listItems.listId, listIds))
    : [];

  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      handle: user.handle,
      displayName: user.displayName,
      bio: user.bio,
      isPrivate: user.isPrivate,
      emailNotifications: user.emailNotifications,
      createdAt: user.createdAt,
    },
    profile: profile ?? null,
    reviews: myReviews.map((r) => ({
      ...r,
      tags: tagRows.filter((t) => t.reviewId === r.id).map((t) => t.name),
    })),
    comments: myComments,
    favoriteAlbums: favorites,
    following: followingRows,
    followers: followerRows,
    blocked: blockedRows,
    hearts,
    lists: myLists.map((l) => ({ ...l, items: items.filter((i) => i.listId === l.id) })),
    queue,
  };
}

/**
 * Starts account deletion: the account disappears from the site immediately and is purged for
 * good after the grace period. Signing in again within the grace period restores it.
 */
export async function requestAccountDeletion(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ role: users.role });
    if (row?.role === "owner") {
      throw new Error("The owner account can't be deleted. Transfer ownership first.");
    }
    await recomputeStatsForUser(tx, userId);
  });
}

/** Undo a pending deletion (called when the user signs in again inside the grace period). */
export async function restoreAccount(userId: string, now = new Date()): Promise<boolean> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.deletedAt || !isWithinGrace(user.deletedAt, now)) return false;
  await db.transaction(async (tx) => {
    await tx.update(users).set({ deletedAt: null }).where(eq(users.id, userId));
    await recomputeStatsForUser(tx, userId);
  });
  return true;
}

/** Permanently removes one user's data and files. */
async function purgeUser(userId: string): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));

  // Remember which albums' counters depend on this user before the rows disappear.
  const [reviewed, favorited] = await Promise.all([
    db.selectDistinct({ id: reviews.albumId }).from(reviews).where(eq(reviews.authorId, userId)),
    db
      .selectDistinct({ id: favoriteAlbums.albumId })
      .from(favoriteAlbums)
      .where(eq(favoriteAlbums.userId, userId)),
  ]);
  const albumIds = [...new Set([...reviewed, ...favorited].map((r) => r.id))];

  const storage = getStorage();
  if (storage) {
    if (user.image && !/^https?:\/\//.test(user.image)) await storage.delete(user.image);
    if (profile?.bannerKey) {
      await storage.delete(profile.bannerKey);
      await storage.delete(bannerSmallKey(profile.bannerKey));
    }
    await storage.deletePrefix(`${REVIEW_IMAGE_PREFIX}${userId}/`);
  }

  // Foreign keys cascade: profile, reviews, comments, follows, blocks, reactions, lists, queue,
  // notifications, reports they filed, sessions and linked sign-in accounts all go with the user.
  await db.transaction(async (tx) => {
    await tx.delete(users).where(eq(users.id, userId));
    for (const albumId of albumIds) await recomputeAlbumStats(tx, albumId);
  });
}

/** Cron job: hard-deletes accounts whose grace period is over. Returns how many were purged. */
export async function purgeDeletedAccounts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS);
  const due = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, cutoff)))
    .limit(50);
  for (const { id } of due) {
    try {
      await purgeUser(id);
    } catch (err) {
      console.error("[account] purge failed", id, err);
    }
  }
  return due.length;
}
