import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { notify, retractNotification } from "./notifications";
import { checkRateLimit, rateLimitMessage } from "./ratelimit";
import { profileVisibleTo, type FollowState, type Viewer } from "./visibility";

const { follows, users, blocks } = schema;

export class SocialError extends Error {
  constructor(
    public code: "not_found" | "forbidden" | "rate_limited" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(
      sql`(${blocks.blockerId} = ${a} AND ${blocks.blockedId} = ${b})
       OR (${blocks.blockerId} = ${b} AND ${blocks.blockedId} = ${a})`,
    )
    .limit(1);
  return !!row;
}

/**
 * Follow someone. Public accounts: takes effect immediately. Private accounts: creates a pending
 * request the owner must approve. Blocked, suspended or deleted accounts look like they don't exist.
 */
export async function followUser(followerId: string, targetId: string): Promise<FollowState> {
  if (followerId === targetId) throw new SocialError("invalid", "You can't follow yourself.");
  const [target] = await getDb().select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target || target.status !== "active" || target.deletedAt || !target.handle) {
    throw new SocialError("not_found", "That account doesn't exist.");
  }
  if (await blockedEitherWay(followerId, targetId)) {
    throw new SocialError("not_found", "That account doesn't exist.");
  }

  const limit = await checkRateLimit(followerId, "follow");
  if (!limit.ok) throw new SocialError("rate_limited", rateLimitMessage(limit));

  const status = target.isPrivate ? "pending" : "accepted";
  return getDb().transaction(async (tx) => {
    const [created] = await tx
      .insert(follows)
      .values({
        followerId,
        followeeId: targetId,
        status,
        acceptedAt: status === "accepted" ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ status: follows.status });
    if (!created) {
      // Already following (or already requested): report the current state, change nothing.
      const [existing] = await tx
        .select({ status: follows.status })
        .from(follows)
        .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, targetId)));
      return existing?.status ?? null;
    }
    await notify(
      {
        recipientId: targetId,
        actorId: followerId,
        type: status === "pending" ? "follow_request" : "follow",
        targetType: "user",
        targetId: followerId,
      },
      tx,
    );
    return status;
  });
}

/** Unfollow, or withdraw a pending request. */
export async function unfollowUser(followerId: string, targetId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .delete(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, targetId)));
    await retractNotification(
      {
        recipientId: targetId,
        actorId: followerId,
        targetType: "user",
        targetId: followerId,
        types: ["follow", "follow_request"],
      },
      tx,
    );
  });
}

/** The owner of a private account accepts or declines a pending request. */
export async function respondToFollowRequest(
  ownerId: string,
  followerId: string,
  accept: boolean,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [pending] = await tx
      .select({ f: follows.followerId })
      .from(follows)
      .where(
        and(
          eq(follows.followeeId, ownerId),
          eq(follows.followerId, followerId),
          eq(follows.status, "pending"),
        ),
      )
      .limit(1);
    if (!pending) return false;

    await retractNotification(
      {
        recipientId: ownerId,
        actorId: followerId,
        targetType: "user",
        targetId: followerId,
        types: ["follow_request"],
      },
      tx,
    );
    if (!accept) {
      await tx
        .delete(follows)
        .where(and(eq(follows.followeeId, ownerId), eq(follows.followerId, followerId)));
      return true;
    }
    await tx
      .update(follows)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(and(eq(follows.followeeId, ownerId), eq(follows.followerId, followerId)));
    await notify(
      {
        recipientId: followerId,
        actorId: ownerId,
        type: "follow_accepted",
        targetType: "user",
        targetId: ownerId,
      },
      tx,
    );
    return true;
  });
}

/** Remove someone who follows you (they aren't told). */
export async function removeFollower(ownerId: string, followerId: string): Promise<void> {
  await getDb()
    .delete(follows)
    .where(and(eq(follows.followeeId, ownerId), eq(follows.followerId, followerId)));
}

export async function getFollowState(viewerId: string, targetId: string): Promise<FollowState> {
  const [row] = await getDb()
    .select({ status: follows.status })
    .from(follows)
    .where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)))
    .limit(1);
  return row?.status ?? null;
}

// --- Lists ----------------------------------------------------------------------------------

export type PersonRow = {
  id: string;
  handle: string;
  displayName: string | null;
  image: string | null;
  bio: string | null;
  isPrivate: boolean;
  /** The signed-in viewer's own follow state for this person. */
  viewerFollow: FollowState;
};

const PAGE = 40;

async function listPeople(
  direction: "followers" | "following",
  userId: string,
  viewer: Viewer,
  page: number,
): Promise<{ items: PersonRow[]; hasMore: boolean }> {
  const db = getDb();
  const other = direction === "followers" ? follows.followerId : follows.followeeId;
  const mine = direction === "followers" ? follows.followeeId : follows.followerId;
  const rows = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      image: users.image,
      bio: users.bio,
      isPrivate: users.isPrivate,
    })
    .from(follows)
    .innerJoin(users, eq(other, users.id))
    .where(and(eq(mine, userId), eq(follows.status, "accepted"), profileVisibleTo(viewer, users)))
    .orderBy(desc(follows.acceptedAt), asc(users.id))
    .limit(PAGE + 1)
    .offset((page - 1) * PAGE);

  const shown = rows.slice(0, PAGE).filter((r) => r.handle);
  return {
    items: await withViewerState(shown, viewer),
    hasMore: rows.length > PAGE,
  };
}

/** Attaches the viewer's own follow state to a list of people (one query). */
export async function withViewerState<
  T extends { id: string; handle: string | null; displayName: string | null; image: string | null },
>(
  people: T[],
  viewer: Viewer,
): Promise<
  Array<
    Omit<T, "handle"> & {
      handle: string;
      viewerFollow: FollowState;
      bio: string | null;
      isPrivate: boolean;
    }
  >
> {
  const states = new Map<string, FollowState>();
  if (viewer && people.length > 0) {
    const mineRows = await getDb()
      .select({ id: follows.followeeId, status: follows.status })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, viewer.id),
          inArray(
            follows.followeeId,
            people.map((p) => p.id),
          ),
        ),
      );
    for (const r of mineRows) states.set(r.id, r.status);
  }
  return people.map((p) => ({
    bio: null,
    isPrivate: false,
    ...p,
    handle: p.handle!,
    viewerFollow: states.get(p.id) ?? null,
  }));
}

export const listFollowers = (userId: string, viewer: Viewer, page = 1) =>
  listPeople("followers", userId, viewer, page);
export const listFollowing = (userId: string, viewer: Viewer, page = 1) =>
  listPeople("following", userId, viewer, page);

/** People who've asked to follow this (private) account, oldest request first. */
export async function listPendingRequests(ownerId: string) {
  return getDb()
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      image: users.image,
      requestedAt: follows.createdAt,
    })
    .from(follows)
    .innerJoin(users, eq(follows.followerId, users.id))
    .where(
      and(
        eq(follows.followeeId, ownerId),
        eq(follows.status, "pending"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(follows.createdAt));
}
