import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { SocialError } from "@/lib/social/follows";
import { notify, retractNotification } from "@/lib/social/notifications";
import { checkRateLimit, rateLimitMessage } from "@/lib/social/ratelimit";
import { authorFacts, canViewContent, loadRelation, type Viewer } from "@/lib/social/visibility";

const { queueItems, albums, artists, users, reviews } = schema;

import { MAX_QUEUE_NOTE, MAX_QUEUE_SIZE } from "./limits";

export { MAX_QUEUE_NOTE, MAX_QUEUE_SIZE };

export type AddResult = "added" | "already_queued" | "already_reviewed";

const cleanNote = (note: string | null | undefined) =>
  note?.trim().slice(0, MAX_QUEUE_NOTE) || null;

async function hasPublishedReview(userId: string, albumId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(
        eq(reviews.authorId, userId),
        eq(reviews.albumId, albumId),
        eq(reviews.status, "published"),
        isNull(reviews.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}

/** Puts an album in your own "In rotation" queue. */
export async function addToQueue(
  ownerId: string,
  albumId: string,
  note?: string | null,
): Promise<AddResult> {
  const db = getDb();
  const [album] = await db.select({ id: albums.id }).from(albums).where(eq(albums.id, albumId));
  if (!album) throw new SocialError("not_found", "That album doesn't exist.");
  if (await hasPublishedReview(ownerId, albumId)) return "already_reviewed";

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(queueItems)
    .where(and(eq(queueItems.ownerId, ownerId), eq(queueItems.status, "queued")));
  if (n >= MAX_QUEUE_SIZE) {
    throw new SocialError("invalid", `Your queue is full (${MAX_QUEUE_SIZE} albums).`);
  }

  // If someone had suggested this, adding it yourself simply accepts it.
  const accepted = await db
    .update(queueItems)
    .set({ status: "queued", queuedAt: new Date() })
    .where(
      and(
        eq(queueItems.ownerId, ownerId),
        eq(queueItems.albumId, albumId),
        eq(queueItems.status, "suggested"),
      ),
    )
    .returning({ id: queueItems.id });
  if (accepted.length > 0) return "added";

  const inserted = await db
    .insert(queueItems)
    .values({ ownerId, albumId, note: cleanNote(note), status: "queued" })
    .onConflictDoNothing()
    .returning({ id: queueItems.id });
  return inserted.length > 0 ? "added" : "already_queued";
}

/** Removes one of your queued albums. */
export async function removeFromQueue(ownerId: string, albumId: string): Promise<void> {
  await getDb()
    .delete(queueItems)
    .where(
      and(
        eq(queueItems.ownerId, ownerId),
        eq(queueItems.albumId, albumId),
        eq(queueItems.status, "queued"),
      ),
    );
}

export type SuggestResult = "suggested" | "already_queued" | "already_reviewed";

/**
 * Suggests an album for someone else's queue (S14). They get a notification and decide whether
 * to accept it. Refused when the person has suggestions off, can't be seen by the suggester
 * (private account, blocked), or when it's yourself.
 */
export async function suggestAlbum(
  suggesterId: string,
  ownerId: string,
  albumId: string,
  note?: string | null,
): Promise<SuggestResult> {
  if (suggesterId === ownerId) {
    throw new SocialError("invalid", "Add it to your own queue instead.");
  }
  const db = getDb();
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
  const viewer: Viewer = { id: suggesterId, isAdmin: false };
  const relation = await loadRelation(viewer, ownerId);
  // Same wording for "doesn't exist" and "can't see": suggestions mustn't reveal private accounts.
  if (!owner || !canViewContent(viewer, authorFacts(owner), relation)) {
    throw new SocialError("not_found", "That person doesn't exist.");
  }
  if (!owner.acceptSuggestions) {
    throw new SocialError("forbidden", "This person isn't taking suggestions.");
  }
  const [album] = await db.select({ id: albums.id }).from(albums).where(eq(albums.id, albumId));
  if (!album) throw new SocialError("not_found", "That album doesn't exist.");
  if (await hasPublishedReview(ownerId, albumId)) return "already_reviewed";

  const limit = await checkRateLimit(suggesterId, "suggest");
  if (!limit.ok) throw new SocialError("rate_limited", rateLimitMessage(limit));

  // Cap pending suggestions so one person can't bury another's inbox.
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(queueItems)
    .where(and(eq(queueItems.ownerId, ownerId), eq(queueItems.status, "suggested")));
  if (pending >= 50) {
    throw new SocialError("forbidden", "This person has a lot of suggestions waiting already.");
  }

  const inserted = await db
    .insert(queueItems)
    .values({
      ownerId,
      albumId,
      suggestedById: suggesterId,
      note: cleanNote(note),
      status: "suggested",
    })
    .onConflictDoNothing()
    .returning({ id: queueItems.id });
  if (inserted.length === 0) return "already_queued";

  await notify({
    recipientId: ownerId,
    actorId: suggesterId,
    type: "suggestion",
    targetType: "album",
    targetId: albumId,
  });
  return "suggested";
}

/** Accept (it joins the queue) or dismiss a suggestion made to you. */
export async function respondToSuggestion(
  ownerId: string,
  itemId: string,
  accept: boolean,
): Promise<boolean> {
  const db = getDb();
  if (accept) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(queueItems)
      .where(and(eq(queueItems.ownerId, ownerId), eq(queueItems.status, "queued")));
    if (n >= MAX_QUEUE_SIZE) {
      throw new SocialError("invalid", `Your queue is full (${MAX_QUEUE_SIZE} albums).`);
    }
  }
  const [row] = await db
    .update(queueItems)
    .set(accept ? { status: "queued", queuedAt: new Date() } : { status: "dismissed" })
    .where(
      and(
        eq(queueItems.id, itemId),
        eq(queueItems.ownerId, ownerId),
        eq(queueItems.status, "suggested"),
      ),
    )
    .returning({ albumId: queueItems.albumId, suggestedById: queueItems.suggestedById });
  if (!row) return false;
  if (!accept && row.suggestedById) {
    // Declined suggestions shouldn't linger as unread notifications.
    await retractNotification({
      recipientId: ownerId,
      actorId: row.suggestedById,
      targetType: "album",
      targetId: row.albumId,
      types: ["suggestion"],
    });
  }
  return true;
}

export type QueueEntry = {
  id: string;
  albumId: string;
  note: string | null;
  createdAt: Date;
  album: {
    mbid: string;
    slug: string;
    title: string;
    coverKey: string | null;
    releaseDate: string | null;
  };
  artist: { name: string; slug: string };
  suggestedBy: { handle: string; displayName: string | null } | null;
};

async function listByStatus(
  ownerId: string,
  status: "queued" | "suggested",
  limit = MAX_QUEUE_SIZE,
): Promise<QueueEntry[]> {
  const rows = await getDb()
    .select({
      id: queueItems.id,
      albumId: albums.id,
      note: queueItems.note,
      createdAt: queueItems.createdAt,
      mbid: albums.mbid,
      slug: albums.slug,
      title: albums.title,
      coverKey: albums.coverKey,
      releaseDate: albums.releaseDate,
      artistName: artists.name,
      artistSlug: artists.slug,
      suggesterHandle: users.handle,
      suggesterName: users.displayName,
      suggesterStatus: users.status,
      suggesterDeleted: users.deletedAt,
    })
    .from(queueItems)
    .innerJoin(albums, eq(queueItems.albumId, albums.id))
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .leftJoin(users, eq(queueItems.suggestedById, users.id))
    .where(and(eq(queueItems.ownerId, ownerId), eq(queueItems.status, status)))
    .orderBy(status === "queued" ? asc(queueItems.createdAt) : desc(queueItems.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const suggesterVisible =
      r.suggesterHandle && r.suggesterStatus === "active" && !r.suggesterDeleted;
    return {
      id: r.id,
      albumId: r.albumId,
      note: r.note,
      createdAt: r.createdAt,
      album: {
        mbid: r.mbid,
        slug: r.slug,
        title: r.title,
        coverKey: r.coverKey,
        releaseDate: r.releaseDate,
      },
      artist: { name: r.artistName, slug: r.artistSlug },
      suggestedBy: suggesterVisible
        ? { handle: r.suggesterHandle!, displayName: r.suggesterName }
        : null,
    };
  });
}

/** The public "In rotation" queue, oldest first. The caller decides whether the viewer may see it. */
export const listQueue = (ownerId: string) => listByStatus(ownerId, "queued");

/** Suggestions awaiting the owner's decision. Only ever shown to the owner. */
export const listSuggestions = (ownerId: string) => listByStatus(ownerId, "suggested", 100);

export async function countSuggestions(ownerId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(queueItems)
    .where(and(eq(queueItems.ownerId, ownerId), eq(queueItems.status, "suggested")));
  return row?.n ?? 0;
}

/** Whether an album is queued (or awaiting a decision) for this user. */
export async function getQueueState(
  userId: string,
  albumId: string,
): Promise<"queued" | "suggested" | null> {
  const [row] = await getDb()
    .select({ status: queueItems.status })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.ownerId, userId),
        eq(queueItems.albumId, albumId),
        inArray(queueItems.status, ["queued", "suggested"]),
      ),
    )
    .limit(1);
  return row ? (row.status as "queued" | "suggested") : null;
}

export async function countQueued(ownerId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(queueItems)
    .where(and(eq(queueItems.ownerId, ownerId), eq(queueItems.status, "queued")));
  return row?.n ?? 0;
}
