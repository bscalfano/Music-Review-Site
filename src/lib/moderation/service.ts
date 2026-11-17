import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { recomputeAlbumStats, recomputeStatsForUser } from "@/lib/albums/stats";
import { bannerSmallKey } from "@/lib/images/process";
import { getStorage } from "@/lib/storage/r2";
import { SocialError } from "@/lib/social/follows";

const { reviews, comments, users, profiles, adminActions } = schema;

/** Who is acting. `role` decides what they may do to whom. */
export type Moderator = { id: string; role: "owner" | "admin" | "member" };

function assertAdmin(mod: Moderator) {
  if (mod.role !== "owner" && mod.role !== "admin") {
    throw new SocialError("forbidden", "Admins only.");
  }
}

async function log(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  note?: string | null,
) {
  await getDb()
    .insert(adminActions)
    .values({ adminId, action, targetType, targetId, note: note?.slice(0, 500) ?? null });
}

/** Takes a published review down. It disappears everywhere and its rating stops counting. */
export async function hideReview(
  mod: Moderator,
  reviewId: string,
  note?: string,
): Promise<boolean> {
  assertAdmin(mod);
  const done = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(reviews)
      .set({ status: "hidden" })
      .where(and(eq(reviews.id, reviewId), eq(reviews.status, "published")))
      .returning({ albumId: reviews.albumId });
    if (!row) return false;
    await recomputeAlbumStats(tx, row.albumId);
    return true;
  });
  if (done) await log(mod.id, "hide_review", "review", reviewId, note);
  return done;
}

export async function unhideReview(mod: Moderator, reviewId: string): Promise<boolean> {
  assertAdmin(mod);
  const done = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(reviews)
      .set({ status: "published" })
      .where(and(eq(reviews.id, reviewId), eq(reviews.status, "hidden")))
      .returning({ albumId: reviews.albumId });
    if (!row) return false;
    await recomputeAlbumStats(tx, row.albumId);
    return true;
  });
  if (done) await log(mod.id, "unhide_review", "review", reviewId);
  return done;
}

export async function removeComment(mod: Moderator, commentId: string, note?: string) {
  assertAdmin(mod);
  const [row] = await getDb()
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
    .returning({ id: comments.id });
  if (row) await log(mod.id, "remove_comment", "comment", commentId, note);
  return !!row;
}

export async function restoreComment(mod: Moderator, commentId: string) {
  assertAdmin(mod);
  const [row] = await getDb()
    .update(comments)
    .set({ deletedAt: null })
    .where(eq(comments.id, commentId))
    .returning({ id: comments.id });
  if (row) await log(mod.id, "restore_comment", "comment", commentId);
  return !!row;
}

async function loadTarget(targetId: string) {
  const [target] = await getDb().select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) throw new SocialError("not_found", "That account doesn't exist.");
  return target;
}

/** Suspension takes effect on the very next request (sessions are re-checked every time). */
export async function suspendUser(mod: Moderator, targetId: string, note?: string) {
  assertAdmin(mod);
  if (targetId === mod.id) throw new SocialError("invalid", "You can't suspend yourself.");
  const target = await loadTarget(targetId);
  if (target.role === "owner") throw new SocialError("forbidden", "The owner can't be suspended.");
  if (target.role === "admin" && mod.role !== "owner") {
    throw new SocialError("forbidden", "Only the owner can suspend an admin.");
  }
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({ status: "suspended" }).where(eq(users.id, targetId));
    await recomputeStatsForUser(tx, targetId);
  });
  await log(mod.id, "suspend_user", "user", targetId, note);
}

export async function unsuspendUser(mod: Moderator, targetId: string) {
  assertAdmin(mod);
  await loadTarget(targetId);
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({ status: "active" }).where(eq(users.id, targetId));
    await recomputeStatsForUser(tx, targetId);
  });
  await log(mod.id, "unsuspend_user", "user", targetId);
}

/** Resets an avatar or banner to the default (and deletes the file). */
export async function resetUserImage(mod: Moderator, targetId: string, kind: "avatar" | "banner") {
  assertAdmin(mod);
  const target = await loadTarget(targetId);
  const db = getDb();
  const storage = getStorage();
  if (kind === "avatar") {
    await db.update(users).set({ image: null }).where(eq(users.id, targetId));
    if (storage && target.image && !/^https?:\/\//.test(target.image)) {
      await storage.delete(target.image);
    }
  } else {
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, targetId));
    await db.update(profiles).set({ bannerKey: null }).where(eq(profiles.userId, targetId));
    if (storage && profile?.bannerKey) {
      await storage.delete(profile.bannerKey);
      await storage.delete(bannerSmallKey(profile.bannerKey));
    }
  }
  await log(mod.id, `reset_${kind}`, "user", targetId);
}

/** Only the owner can promote or demote admins. The owner's own role never changes here. */
export async function setUserRole(mod: Moderator, targetId: string, role: "admin" | "member") {
  if (mod.role !== "owner") throw new SocialError("forbidden", "Only the owner can change roles.");
  const target = await loadTarget(targetId);
  if (target.role === "owner") throw new SocialError("forbidden", "The owner's role can't change.");
  await getDb().update(users).set({ role }).where(eq(users.id, targetId));
  await log(mod.id, role === "admin" ? "make_admin" : "remove_admin", "user", targetId);
}

export async function searchUsers(query: string, limit = 30) {
  const q = query.trim();
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  return getDb()
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      q
        ? or(ilike(users.handle, like), ilike(users.displayName, like), ilike(users.email, like))
        : undefined,
    )
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

export async function recentAdminActions(limit = 30) {
  return getDb()
    .select({
      id: adminActions.id,
      action: adminActions.action,
      targetType: adminActions.targetType,
      targetId: adminActions.targetId,
      note: adminActions.note,
      createdAt: adminActions.createdAt,
      adminHandle: users.handle,
    })
    .from(adminActions)
    .leftJoin(users, eq(adminActions.adminId, users.id))
    .orderBy(desc(adminActions.createdAt))
    .limit(limit);
}
