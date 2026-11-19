import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DbLike } from "@/db/types";
import { enqueue } from "@/lib/jobs/queue";

const { notifications, users, reviews, comments, albums, blocks } = schema;

export type NotificationType = (typeof schema.notificationType.enumValues)[number];
export type NotificationTarget = (typeof schema.notificationTarget.enumValues)[number];

/** What each type is called in settings, in display order. */
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  comment: "Someone comments on my review",
  reply: "Someone replies to my comment",
  reaction: "Someone hearts my review or comment",
  follow: "Someone follows me",
  follow_request: "Someone requests to follow me",
  follow_accepted: "My follow request is accepted",
  suggestion: "Someone suggests an album for my queue",
};

export type NotifyInput = {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  targetType: NotificationTarget;
  targetId: string;
};

/**
 * Creates an in-app notification (and queues an email if the recipient opted in). Quietly does
 * nothing for notifications to yourself, between blocked users, or that already exist (the same
 * person hearting the same review twice notifies once).
 */
export async function notify(input: NotifyInput, db: DbLike = getDb()): Promise<void> {
  if (input.recipientId === input.actorId) return;

  const [blocked] = await db
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, input.recipientId), eq(blocks.blockedId, input.actorId)),
        and(eq(blocks.blockerId, input.actorId), eq(blocks.blockedId, input.recipientId)),
      ),
    )
    .limit(1);
  if (blocked) return;

  const [created] = await db
    .insert(notifications)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (!created) return;

  const [recipient] = await db
    .select({ prefs: users.emailNotifications })
    .from(users)
    .where(eq(users.id, input.recipientId))
    .limit(1);
  if (recipient?.prefs.includes(input.type)) {
    await enqueue("notification_email", { notificationId: created.id }, { db });
  }
}

/** Removes notifications an actor caused for a target (e.g. when they unfollow or un-heart). */
export async function retractNotification(
  input: Pick<NotifyInput, "recipientId" | "actorId" | "targetType" | "targetId"> & {
    types: NotificationType[];
  },
  db: DbLike = getDb(),
): Promise<void> {
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.recipientId, input.recipientId),
        eq(notifications.actorId, input.actorId),
        eq(notifications.targetType, input.targetType),
        eq(notifications.targetId, input.targetId),
        inArray(notifications.type, input.types),
      ),
    );
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
}

export type NotificationItem = {
  id: string;
  type: NotificationType;
  read: boolean;
  createdAt: Date;
  actor: { id: string; handle: string | null; displayName: string | null; image: string | null };
  /** Where clicking should go, and what the notification is about. */
  href: string;
  subject: string | null;
};

const PAGE = 30;

/** A user's notifications, newest first, with the links and titles needed to display them. */
export async function listNotifications(
  userId: string,
  cursor?: Date,
): Promise<{ items: NotificationItem[]; nextCursor: Date | null }> {
  const db = getDb();
  const rows = await db
    .select({ n: notifications, actor: users })
    .from(notifications)
    .innerJoin(users, eq(notifications.actorId, users.id))
    .where(
      and(
        eq(notifications.recipientId, userId),
        // Notifications from suspended or deleted people just disappear.
        eq(users.status, "active"),
        isNull(users.deletedAt),
        cursor ? lt(notifications.createdAt, cursor) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(PAGE + 1);

  const page = rows.slice(0, PAGE);
  const reviewIds = page.filter((r) => r.n.targetType === "review").map((r) => r.n.targetId);
  const commentIds = page.filter((r) => r.n.targetType === "comment").map((r) => r.n.targetId);

  const reviewInfo = new Map<string, { href: string; subject: string }>();
  if (reviewIds.length > 0) {
    const found = await db
      .select({ id: reviews.id, handle: users.handle, slug: reviews.slug, album: albums.title })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .where(inArray(reviews.id, reviewIds));
    for (const r of found) {
      reviewInfo.set(r.id, { href: `/u/${r.handle}/${r.slug}`, subject: r.album });
    }
  }
  if (commentIds.length > 0) {
    const found = await db
      .select({
        id: comments.id,
        handle: users.handle,
        slug: reviews.slug,
        album: albums.title,
      })
      .from(comments)
      .innerJoin(reviews, eq(comments.reviewId, reviews.id))
      .innerJoin(users, eq(reviews.authorId, users.id))
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .where(inArray(comments.id, commentIds));
    for (const r of found) {
      reviewInfo.set(r.id, {
        href: `/u/${r.handle}/${r.slug}#comment-${r.id}`,
        subject: r.album,
      });
    }
  }

  // Suggestions point at the recipient's own queue, where they can answer them.
  const [me] = await db
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const items = page.map(({ n, actor }): NotificationItem => {
    const info = reviewInfo.get(n.targetId);
    const profile = `/u/${actor.handle}`;
    const href =
      n.type === "suggestion" && me?.handle ? `/u/${me.handle}?tab=queue` : (info?.href ?? profile);
    return {
      id: n.id,
      type: n.type,
      read: n.readAt !== null,
      createdAt: n.createdAt,
      actor: {
        id: actor.id,
        handle: actor.handle,
        displayName: actor.displayName,
        image: actor.image,
      },
      href,
      subject: info?.subject ?? null,
    };
  });
  return {
    items,
    nextCursor: rows.length > PAGE ? page[page.length - 1].n.createdAt : null,
  };
}
