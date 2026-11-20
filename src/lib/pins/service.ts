import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { GridItem } from "@/lib/profiles/queries";
import { authorVisibleTo, type Viewer } from "@/lib/social/visibility";

const { reviews, lists, listItems, albums, artists, users } = schema;

/** Reviews and shelves combined. */
export const MAX_PINS = 3;

export class PinError extends Error {}

export type PinKind = "review" | "shelf";

/**
 * Pins or unpins one of the author's own published reviews or shelves. Returns the new state.
 * Only public things can be pinned, and an author has at most MAX_PINS in total.
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
    const [[r], [l]] = await Promise.all([
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(reviews)
        .where(
          and(eq(reviews.authorId, userId), isNotNull(reviews.pinnedAt), isNull(reviews.deletedAt)),
        ),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(lists)
        .where(and(eq(lists.authorId, userId), isNotNull(lists.pinnedAt))),
    ]);
    if (r.n + l.n >= MAX_PINS) {
      throw new PinError(`You can pin up to ${MAX_PINS}. Unpin one first.`);
    }
    await tx.update(table).set({ pinnedAt: new Date() }).where(eq(table.id, id));
    return { pinned: true };
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

/** What the viewer may see pinned on this person's profile, most recently pinned first. */
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
        excerpt: r.body.replace(/\s+/g, " ").trim().slice(0, 240),
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
  return entries.sort((a, b) => b.pinnedAt.getTime() - a.pinnedAt.getTime());
}
