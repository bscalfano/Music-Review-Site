import { and, asc, desc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { DbLike } from "@/db/types";
import { ensureAlbum } from "@/lib/albums/ensure-album";
import { slugify } from "@/lib/slug";
import {
  MAX_LIST_DESCRIPTION,
  MAX_LIST_ITEMS,
  MAX_LIST_NOTE,
  MAX_LIST_TITLE,
  MAX_LISTS_PER_USER,
} from "./limits";
import { authorVisibleTo, type Viewer } from "@/lib/social/visibility";

const { lists, listItems, albums, artists, users, reviews } = schema;

export * from "./limits";

export const listInputSchema = z.object({
  title: z.string().trim().min(1, "Give your shelf a title.").max(MAX_LIST_TITLE),
  description: z
    .string()
    .trim()
    .max(MAX_LIST_DESCRIPTION)
    .transform((v) => v || null),
  ranked: z.boolean(),
  year: z.number().int().min(1900).max(2100).nullable(),
  status: z.enum(["draft", "published"]),
  items: z
    .array(
      z.object({
        albumMbid: z.uuid(),
        note: z
          .string()
          .trim()
          .max(MAX_LIST_NOTE)
          .transform((v) => v || null),
      }),
    )
    .max(MAX_LIST_ITEMS, `Lists can have up to ${MAX_LIST_ITEMS} albums.`),
});
export type ListInput = z.infer<typeof listInputSchema>;

export class ListError extends Error {
  constructor(
    public code: "not_found" | "invalid" | "limit",
    message: string,
  ) {
    super(message);
    this.name = "ListError";
  }
}

async function uniqueListSlug(
  db: DbLike,
  authorId: string,
  title: string,
  exceptId?: string,
): Promise<string> {
  const base = slugify(title, 60) || "shelf";
  const rows = await db
    .select({ slug: lists.slug })
    .from(lists)
    .where(
      and(
        eq(lists.authorId, authorId),
        like(lists.slug, `${base.replace(/[\\%_]/g, "\\$&")}%`),
        exceptId ? ne(lists.id, exceptId) : undefined,
      ),
    );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Creates (listId null) or replaces a list owned by `authorId`. Albums are looked up (and created
 * from MusicBrainz if new) first, so a slow lookup never holds the transaction open. Each item is
 * linked to the author's own review of that album, when there is one.
 */
export async function saveList(
  authorId: string,
  listId: string | null,
  input: ListInput,
): Promise<{ id: string; slug: string; status: "draft" | "published" }> {
  const db = getDb();

  // Resolve albums outside the transaction; keep first occurrence of a repeated album.
  const resolved: { albumId: string; note: string | null }[] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.albumMbid)) continue;
    seen.add(item.albumMbid);
    const album = await ensureAlbum(item.albumMbid);
    if (!album) throw new ListError("not_found", "One of those albums couldn't be found.");
    resolved.push({ albumId: album.id, note: item.note });
  }

  return db.transaction(async (tx) => {
    let firstPublishedAt: Date | null = null;
    if (listId) {
      const [mine] = await tx
        .select({
          id: lists.id,
          status: lists.status,
          title: lists.title,
          slug: lists.slug,
          publishedAt: lists.publishedAt,
        })
        .from(lists)
        .where(and(eq(lists.id, listId), eq(lists.authorId, authorId)))
        .limit(1);
      if (!mine) throw new ListError("not_found", "That shelf doesn't exist.");
      firstPublishedAt = mine.publishedAt;
      if (mine.status === "hidden") {
        throw new ListError("invalid", "A moderator took this shelf down, so it can't be edited.");
      }
    } else {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(lists)
        .where(eq(lists.authorId, authorId));
      if (n >= MAX_LISTS_PER_USER) {
        throw new ListError("limit", `You can have up to ${MAX_LISTS_PER_USER} shelves.`);
      }
    }

    const slug = await uniqueListSlug(tx, authorId, input.title, listId ?? undefined);
    const values = {
      title: input.title,
      slug,
      description: input.description,
      ranked: input.ranked,
      year: input.year,
      status: input.status,
      // The feed shows a shelf from the moment it first goes public.
      publishedAt: firstPublishedAt ?? (input.status === "published" ? new Date() : null),
      updatedAt: new Date(),
    };
    let id: string;
    if (listId) {
      id = listId;
      await tx.update(lists).set(values).where(eq(lists.id, listId));
      await tx.delete(listItems).where(eq(listItems.listId, listId));
    } else {
      [{ id }] = await tx
        .insert(lists)
        .values({ ...values, authorId })
        .returning({ id: lists.id });
    }

    if (resolved.length > 0) {
      const mineReviews = await tx
        .select({ id: reviews.id, albumId: reviews.albumId })
        .from(reviews)
        .where(
          and(
            eq(reviews.authorId, authorId),
            eq(reviews.status, "published"),
            isNull(reviews.deletedAt),
          ),
        );
      const reviewByAlbum = new Map(mineReviews.map((r) => [r.albumId, r.id]));
      await tx.insert(listItems).values(
        resolved.map((r, i) => ({
          listId: id,
          position: i + 1,
          albumId: r.albumId,
          reviewId: reviewByAlbum.get(r.albumId) ?? null,
          note: r.note,
        })),
      );
    }
    return { id, slug, status: input.status };
  });
}

export async function deleteList(authorId: string, listId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(lists)
    .where(and(eq(lists.id, listId), eq(lists.authorId, authorId)))
    .returning({ id: lists.id });
  return rows.length > 0;
}

// --- Reading --------------------------------------------------------------------------------

export type ListItemView = {
  position: number;
  note: string | null;
  album: {
    mbid: string;
    slug: string;
    title: string;
    coverKey: string | null;
    releaseDate: string | null;
  };
  artist: { name: string; slug: string };
  /** Link to the author's own review of this album, when it has one the viewer can open. */
  reviewSlug: string | null;
  rating: number | null;
};

export type ListView = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  ranked: boolean;
  year: number | null;
  status: "draft" | "published" | "hidden";
  updatedAt: Date;
  author: {
    id: string;
    handle: string;
    displayName: string | null;
    image: string | null;
    isPrivate: boolean;
  };
  items: ListItemView[];
};

/**
 * A list by author handle and slug, only if `viewer` may see it: published lists follow the same
 * visibility rule as reviews; drafts and taken-down lists are visible to their author and admins.
 */
export async function getList(
  handle: string,
  slug: string,
  viewer: Viewer,
): Promise<ListView | null> {
  const db = getDb();
  const [row] = await db
    .select({ list: lists, author: users })
    .from(lists)
    .innerJoin(users, eq(lists.authorId, users.id))
    .where(
      and(
        eq(users.handle, handle.toLowerCase()),
        eq(lists.slug, slug),
        authorVisibleTo(viewer, users),
      ),
    )
    .limit(1);
  if (!row) return null;
  const isOwner = viewer?.id === row.author.id;
  if (row.list.status !== "published" && !isOwner && !viewer?.isAdmin) return null;

  const items = await db
    .select({
      position: listItems.position,
      note: listItems.note,
      mbid: albums.mbid,
      slug: albums.slug,
      title: albums.title,
      coverKey: albums.coverKey,
      releaseDate: albums.releaseDate,
      artistName: artists.name,
      artistSlug: artists.slug,
      reviewSlug: reviews.slug,
      rating: reviews.rating,
    })
    .from(listItems)
    .innerJoin(albums, eq(listItems.albumId, albums.id))
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .leftJoin(
      reviews,
      and(
        eq(reviews.authorId, row.author.id),
        eq(reviews.albumId, albums.id),
        eq(reviews.status, "published"),
        isNull(reviews.deletedAt),
      ),
    )
    .where(eq(listItems.listId, row.list.id))
    .orderBy(asc(listItems.position));

  return {
    id: row.list.id,
    slug: row.list.slug,
    title: row.list.title,
    description: row.list.description,
    ranked: row.list.ranked,
    year: row.list.year,
    status: row.list.status,
    updatedAt: row.list.updatedAt,
    author: {
      id: row.author.id,
      handle: row.author.handle!,
      displayName: row.author.displayName,
      image: row.author.image,
      isPrivate: row.author.isPrivate,
    },
    items: items.map((i) => ({
      position: i.position,
      note: i.note,
      album: {
        mbid: i.mbid,
        slug: i.slug,
        title: i.title,
        coverKey: i.coverKey,
        releaseDate: i.releaseDate,
      },
      artist: { name: i.artistName, slug: i.artistSlug },
      reviewSlug: i.reviewSlug,
      rating: i.rating,
    })),
  };
}

export type ListSummary = {
  id: string;
  slug: string;
  title: string;
  ranked: boolean;
  year: number | null;
  status: "draft" | "published" | "hidden";
  itemCount: number;
  /** Up to forty covers for the mini shelf. */
  covers: { mbid: string; title: string; coverKey: string | null }[];
  updatedAt: Date;
};

/** A user's lists. The caller has already decided the viewer may see this user's content. */
export async function listsForUser(userId: string, includeDrafts: boolean): Promise<ListSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(lists)
    .where(
      and(
        eq(lists.authorId, userId),
        includeDrafts ? ne(lists.status, "hidden") : eq(lists.status, "published"),
      ),
    )
    .orderBy(desc(lists.year), desc(lists.updatedAt));
  if (rows.length === 0) return [];

  const items = await db
    .select({
      listId: listItems.listId,
      position: listItems.position,
      mbid: albums.mbid,
      title: albums.title,
      coverKey: albums.coverKey,
    })
    .from(listItems)
    .innerJoin(albums, eq(listItems.albumId, albums.id))
    .where(
      inArray(
        listItems.listId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(listItems.position));

  return rows.map((l) => {
    const mine = items.filter((i) => i.listId === l.id);
    return {
      id: l.id,
      slug: l.slug,
      title: l.title,
      ranked: l.ranked,
      year: l.year,
      status: l.status,
      itemCount: mine.length,
      covers: mine
        .slice(0, 40)
        .map((i) => ({ mbid: i.mbid, title: i.title, coverKey: i.coverKey })),
      updatedAt: l.updatedAt,
    };
  });
}

/** For the editor: one of the author's own lists, in the shape the editor works with. */
export async function getListForEdit(authorId: string, listId: string) {
  const db = getDb();
  const [list] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.authorId, authorId)))
    .limit(1);
  if (!list) return null;
  const items = await db
    .select({
      note: listItems.note,
      mbid: albums.mbid,
      title: albums.title,
      coverKey: albums.coverKey,
      artistName: artists.name,
    })
    .from(listItems)
    .innerJoin(albums, eq(listItems.albumId, albums.id))
    .innerJoin(artists, eq(albums.artistId, artists.id))
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position));
  return { list, items };
}

export async function countLists(userId: string, includeDrafts: boolean): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(lists)
    .where(
      and(
        eq(lists.authorId, userId),
        includeDrafts ? ne(lists.status, "hidden") : eq(lists.status, "published"),
      ),
    );
  return row?.n ?? 0;
}
