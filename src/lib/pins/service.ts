import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { albumCoverUrl } from "@/lib/music";
import type { GridItem } from "@/lib/profiles/queries";
import { authorVisibleTo, type Viewer } from "@/lib/social/visibility";

const { reviews, lists, listItems, albums, artists, users } = schema;

/** Separate limits: three pinned reviews, two pinned shelves. */
export const MAX_PINNED_REVIEWS = 3;
export const MAX_PINNED_SHELVES = 2;

export class PinError extends Error {}

export type PinKind = "review" | "shelf";

/**
 * Pins or unpins one of the author's own published reviews or shelves. Returns the new state.
 * Only public things can be pinned, and an author has at most MAX_PINNED_REVIEWS reviews and MAX_PINNED_SHELVES shelves pinned.
 */
export async function togglePin(
  userId: string,
  kind: PinKind,
  id: string,
): Promise<{ pinned: boolean }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Lock the author row so two quick pins can't both slip under the limit.
    await tx.execute(sql`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`);
    const table = kind === "review" ? reviews : lists;
    const [row] = await tx
      .select({ pinnedAt: table.pinnedAt, status: table.status })
      .from(table)
      .where(
        and(
          eq(table.id, id),
          eq(table.authorId, userId),
          kind === "review" ? isNull(reviews.deletedAt) : undefined,
        ),
      )
      .limit(1);
    if (!row) throw new PinError("That doesn't exist.");
    if (row.pinnedAt) {
      await tx.update(table).set({ pinnedAt: null }).where(eq(table.id, id));
      return { pinned: false };
    }
    if (row.status !== "published") throw new PinError("Only published items can be pinned.");
    const max = kind === "review" ? MAX_PINNED_REVIEWS : MAX_PINNED_SHELVES;
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(
        and(
          eq(table.authorId, userId),
          isNotNull(table.pinnedAt),
          kind === "review" ? isNull(reviews.deletedAt) : undefined,
        ),
      );
    if (n >= max) {
      throw new PinError(
        `You can pin up to ${max} ${kind === "review" ? "reviews" : "shelves"}. Unpin one first.`,
      );
    }
    // A new pin takes the next free slot, after the ones already pinned (newest pinned_at shows first).
    const [oldest] = await tx
      .select({ at: sql<Date | null>`min(${table.pinnedAt})` })
      .from(table)
      .where(and(eq(table.authorId, userId), isNotNull(table.pinnedAt)));
    const pinnedAt = oldest?.at ? new Date(new Date(oldest.at).getTime() - 1000) : new Date();
    await tx.update(table).set({ pinnedAt }).where(eq(table.id, id));
    return { pinned: true };
  });
}

/**
 * Saves a new order for the author's pinned reviews or shelves (first = shown first). `ids` may be
 * a subset of what's pinned, since hidden items aren't shown to reorder. Order is kept in
 * `pinned_at`: each item gets a timestamp a second apart, newest first.
 */
export async function reorderPins(userId: string, kind: PinKind, ids: string[]): Promise<void> {
  if (new Set(ids).size !== ids.length) throw new PinError("Invalid order.");
  const table = kind === "review" ? reviews : lists;
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.authorId, userId), isNotNull(table.pinnedAt), inArray(table.id, ids)));
    if (rows.length !== ids.length) {
      throw new PinError("Your pins changed. Reload the page and try again.");
    }
    const base = Date.now();
    for (const [i, id] of ids.entries()) {
      await tx
        .update(table)
        .set({ pinnedAt: new Date(base - i * 1000) })
        .where(eq(table.id, id));
    }
  });
}

export async function isPinned(kind: PinKind, id: string): Promise<boolean> {
  const table = kind === "review" ? reviews : lists;
  const [row] = await getDb()
    .select({ pinnedAt: table.pinnedAt })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return !!row?.pinnedAt;
}

/** First lines of a review as plain text: markdown images, directives and quote marks removed. */
function plainExcerpt(body: string): string {
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/::[a-z]+(\[[^\]]*\])?/gi, "")
    .replace(/[>#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export type PinnedShelf = {
  id: string;
  slug: string;
  title: string;
  itemCount: number;
  ranked: boolean;
  covers: { mbid: string; slug: string; title: string; coverKey: string | null }[];
};

export type PinnedEntry =
  | { kind: "review"; pinnedAt: Date; review: GridItem & { excerpt: string } }
  | { kind: "shelf"; pinnedAt: Date; shelf: PinnedShelf };

/** What the viewer may see pinned on this person's profile, reviews first, then shelves, each most recently pinned first. */
export async function getPins(userId: string, viewer: Viewer): Promise<PinnedEntry[]> {
  const db = getDb();
  const [reviewRows, shelfRows] = await Promise.all([
    db
      .select({
        id: reviews.id,
        slug: reviews.slug,
        rating: reviews.rating,
        body: reviews.body,
        publishedAt: reviews.publishedAt,
        pinnedAt: reviews.pinnedAt,
        album: { mbid: albums.mbid, title: albums.title, coverKey: albums.coverKey },
        artistName: artists.name,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.authorId, users.id))
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .innerJoin(artists, eq(albums.artistId, artists.id))
      .where(
        and(
          eq(reviews.authorId, userId),
          isNotNull(reviews.pinnedAt),
          eq(reviews.status, "published"),
          isNull(reviews.deletedAt),
          authorVisibleTo(viewer, users),
        ),
      )
      .orderBy(desc(reviews.pinnedAt)),
    db
      .select({
        id: lists.id,
        slug: lists.slug,
        title: lists.title,
        ranked: lists.ranked,
        pinnedAt: lists.pinnedAt,
        itemCount: sql<number>`(SELECT count(*)::int FROM list_items li WHERE li.list_id = ${lists.id})`,
      })
      .from(lists)
      .innerJoin(users, eq(lists.authorId, users.id))
      .where(
        and(
          eq(lists.authorId, userId),
          isNotNull(lists.pinnedAt),
          eq(lists.status, "published"),
          authorVisibleTo(viewer, users),
        ),
      )
      .orderBy(desc(lists.pinnedAt)),
  ]);

  const covers = new Map<string, PinnedShelf["covers"]>();
  if (shelfRows.length > 0) {
    const rows = await db
      .select({
        listId: listItems.listId,
        mbid: albums.mbid,
        slug: albums.slug,
        title: albums.title,
        coverKey: albums.coverKey,
      })
      .from(listItems)
      .innerJoin(albums, eq(listItems.albumId, albums.id))
      .where(
        and(
          inArray(
            listItems.listId,
            shelfRows.map((r) => r.id),
          ),
          lte(listItems.position, 40),
        ),
      )
      .orderBy(asc(listItems.position));
    for (const r of rows) {
      const list = covers.get(r.listId) ?? [];
      list.push({ mbid: r.mbid, slug: r.slug, title: r.title, coverKey: r.coverKey });
      covers.set(r.listId, list);
    }
  }

  const entries: PinnedEntry[] = [
    ...reviewRows.map((r): PinnedEntry => ({
      kind: "review",
      pinnedAt: r.pinnedAt!,
      review: {
        id: r.id,
        slug: r.slug,
        rating: r.rating,
        hasBody: r.body !== "",
        publishedAt: r.publishedAt,
        album: r.album,
        artistName: r.artistName,
        excerpt: plainExcerpt(r.body),
      },
    })),
    ...shelfRows.map((s): PinnedEntry => ({
      kind: "shelf",
      pinnedAt: s.pinnedAt!,
      shelf: {
        id: s.id,
        slug: s.slug,
        title: s.title,
        itemCount: s.itemCount,
        ranked: s.ranked,
        covers: covers.get(s.id) ?? [],
      },
    })),
  ];
  const sorted = entries.sort((a, b) => b.pinnedAt.getTime() - a.pinnedAt.getTime());
  return [
    ...sorted.filter((e) => e.kind === "review").slice(0, MAX_PINNED_REVIEWS),
    ...sorted.filter((e) => e.kind === "shelf").slice(0, MAX_PINNED_SHELVES),
  ];
}

export type PinCandidate = {
  id: string;
  title: string;
  subtitle: string;
  coverUrl: string | null;
};

/** The author's published, not-yet-pinned reviews or shelves, newest first, for the "Add pin" picker. */
export async function getPinCandidates(userId: string, kind: PinKind): Promise<PinCandidate[]> {
  const db = getDb();
  if (kind === "review") {
    const rows = await db
      .select({
        id: reviews.id,
        title: albums.title,
        artist: artists.name,
        mbid: albums.mbid,
        coverKey: albums.coverKey,
      })
      .from(reviews)
      .innerJoin(albums, eq(reviews.albumId, albums.id))
      .innerJoin(artists, eq(albums.artistId, artists.id))
      .where(
        and(
          eq(reviews.authorId, userId),
          eq(reviews.status, "published"),
          isNull(reviews.deletedAt),
          isNull(reviews.pinnedAt),
        ),
      )
      .orderBy(desc(reviews.publishedAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.artist,
      coverUrl: albumCoverUrl({ mbid: r.mbid, coverKey: r.coverKey }, 250),
    }));
  }
  const rows = await db
    .select({
      id: lists.id,
      title: lists.title,
      count: sql<number>`(SELECT count(*)::int FROM list_items li WHERE li.list_id = ${lists.id})`,
      mbid: albums.mbid,
      coverKey: albums.coverKey,
    })
    .from(lists)
    .leftJoin(listItems, and(eq(listItems.listId, lists.id), eq(listItems.position, 1)))
    .leftJoin(albums, eq(listItems.albumId, albums.id))
    .where(and(eq(lists.authorId, userId), eq(lists.status, "published"), isNull(lists.pinnedAt)))
    .orderBy(desc(lists.updatedAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: `${r.count} ${r.count === 1 ? "album" : "albums"}`,
    coverUrl: r.mbid ? albumCoverUrl({ mbid: r.mbid, coverKey: r.coverKey }, 250) : null,
  }));
}
