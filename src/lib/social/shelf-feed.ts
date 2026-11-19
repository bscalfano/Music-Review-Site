import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { decodeCursor, encodeCursor } from "@/lib/profiles/queries";
import { getFollowingFeed, type FeedItem } from "./feed";
import { authorVisibleTo, type Viewer } from "./visibility";

const { lists, listItems, albums, artists, users } = schema;

const PAGE_SIZE = 20;

export type ShelfFeedItem = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  ranked: boolean;
  year: number | null;
  itemCount: number;
  publishedAt: Date;
  author: { handle: string; displayName: string | null; image: string | null };
  covers: { mbid: string; slug: string; title: string; coverKey: string | null }[];
};

/** One entry in the Following feed: a review or log, or a shelf someone just published. */
export type FeedEntry =
  | { kind: "review"; at: Date; id: string; item: FeedItem }
  | { kind: "shelf"; at: Date; id: string; shelf: ShelfFeedItem };

/**
 * Published shelves by the viewer and the people they follow (accepted), newest first, with the
 * same visibility rule as reviews. Empty shelves are skipped.
 */
async function getFollowingShelves(
  viewer: NonNullable<Viewer>,
  cursor?: string,
  limit = PAGE_SIZE,
): Promise<{ items: ShelfFeedItem[]; more: boolean }> {
  const db = getDb();
  const c = decodeCursor(cursor);
  const rows = await db
    .select({
      id: lists.id,
      slug: lists.slug,
      title: lists.title,
      description: lists.description,
      ranked: lists.ranked,
      year: lists.year,
      publishedAt: lists.publishedAt,
      handle: users.handle,
      displayName: users.displayName,
      image: users.image,
      itemCount: sql<number>`(SELECT count(*)::int FROM list_items li WHERE li.list_id = ${lists.id})`,
    })
    .from(lists)
    .innerJoin(users, eq(lists.authorId, users.id))
    .where(
      and(
        eq(lists.status, "published"),
        sql`${lists.publishedAt} IS NOT NULL`,
        authorVisibleTo(viewer, users),
        sql`(${lists.authorId} = ${viewer.id} OR EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = ${viewer.id} AND f.followee_id = ${lists.authorId}
            AND f.status = 'accepted'
        ))`,
        sql`EXISTS (SELECT 1 FROM list_items li WHERE li.list_id = ${lists.id})`,
        c
          ? sql`(${lists.publishedAt}, ${lists.id}) < (${c.at}::timestamptz, ${c.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(sql`${lists.publishedAt} DESC`, sql`${lists.id} DESC`)
    .limit(limit + 1);

  const shown = rows.slice(0, limit);
  const covers = new Map<string, ShelfFeedItem["covers"]>();
  if (shown.length > 0) {
    const coverRows = await db
      .select({
        listId: listItems.listId,
        mbid: albums.mbid,
        slug: albums.slug,
        title: albums.title,
        coverKey: albums.coverKey,
      })
      .from(listItems)
      .innerJoin(albums, eq(listItems.albumId, albums.id))
      .innerJoin(artists, eq(albums.artistId, artists.id))
      .where(
        and(
          inArray(
            listItems.listId,
            shown.map((r) => r.id),
          ),
          lte(listItems.position, 40),
        ),
      )
      .orderBy(asc(listItems.position));
    for (const r of coverRows) {
      const list = covers.get(r.listId) ?? [];
      list.push({ mbid: r.mbid, slug: r.slug, title: r.title, coverKey: r.coverKey });
      covers.set(r.listId, list);
    }
  }

  return {
    more: rows.length > limit,
    items: shown.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      ranked: r.ranked,
      year: r.year,
      itemCount: r.itemCount,
      publishedAt: r.publishedAt!,
      author: { handle: r.handle!, displayName: r.displayName, image: r.image },
      covers: covers.get(r.id) ?? [],
    })),
  };
}

/**
 * The Following feed with shelves mixed in, newest first. Each source supplies its own newest
 * page and the two are merged, so the combined (time, id) cursor stays exact.
 */
export async function getFollowingStream(
  viewer: NonNullable<Viewer>,
  cursor?: string,
): Promise<{ entries: FeedEntry[]; nextCursor: string | null }> {
  const [reviewPage, shelfPage] = await Promise.all([
    getFollowingFeed(viewer, cursor),
    getFollowingShelves(viewer, cursor),
  ]);
  const all: FeedEntry[] = [
    ...reviewPage.items
      .filter((item) => item.publishedAt)
      .map((item): FeedEntry => ({ kind: "review", at: item.publishedAt!, id: item.id, item })),
    ...shelfPage.items.map((shelf): FeedEntry => ({
      kind: "shelf",
      at: shelf.publishedAt,
      id: shelf.id,
      shelf,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1));

  const entries = all.slice(0, PAGE_SIZE);
  const more = all.length > PAGE_SIZE || reviewPage.nextCursor !== null || shelfPage.more;
  const last = entries[entries.length - 1];
  return {
    entries,
    nextCursor: more && last ? encodeCursor({ id: last.id, publishedAt: last.at }) : null,
  };
}
