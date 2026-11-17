import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DbLike } from "@/db/types";
import { recomputeAlbumStats } from "@/lib/albums/stats";
import { slugify } from "@/lib/slug";
import { normalizeTags, ratingSchema } from "./schema";

const { reviews, albums, tracks, tags, reviewTags } = schema;

export class ReviewError extends Error {
  constructor(
    public code: "not_found" | "bad_clip" | "bad_rating",
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export type SaveReviewInput = {
  albumId: string;
  /** When editing a specific review. Omit to create (or update the author's existing one). */
  reviewId?: string | null;
  title: string | null;
  body: string;
  rating: number | null;
  clipTrackId: string | null;
  tags: string[];
  status: "draft" | "published";
};

export type SavedReview = {
  id: string;
  slug: string;
  status: "draft" | "published";
  albumId: string;
};

type Tx = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update" | "delete" | "execute">;

/** A slug unique among this author's live reviews: the album title, then -2, -3... */
async function uniqueSlug(db: DbLike, authorId: string, albumTitle: string): Promise<string> {
  const base = slugify(albumTitle, 60);
  const rows = await db
    .select({ slug: reviews.slug })
    .from(reviews)
    .where(
      and(
        eq(reviews.authorId, authorId),
        isNull(reviews.deletedAt),
        like(reviews.slug, `${base.replace(/[\\%_]/g, "\\$&")}%`),
      ),
    );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

async function findExisting(
  db: DbLike,
  authorId: string,
  albumId: string,
  reviewId?: string | null,
) {
  const [row] = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.authorId, authorId),
        isNull(reviews.deletedAt),
        reviewId ? eq(reviews.id, reviewId) : eq(reviews.albumId, albumId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function replaceTags(db: DbLike, reviewId: string, names: string[]) {
  await db.delete(reviewTags).where(eq(reviewTags.reviewId, reviewId));
  const clean = normalizeTags(names);
  if (clean.length === 0) return;
  await db
    .insert(tags)
    .values(clean.map((name) => ({ name })))
    .onConflictDoNothing({ target: tags.name });
  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, clean));
  await db.insert(reviewTags).values(rows.map((t) => ({ reviewId, tagId: t.id })));
}

/**
 * Creates or updates the author's review of an album (one per author per album) and keeps
 * album_stats in step, all in one transaction. Authorization is the caller's job: this trusts
 * `authorId`. Publishing with no body and no rating is allowed: it's a "listened" log (S23).
 */
export async function saveReview(authorId: string, input: SaveReviewInput): Promise<SavedReview> {
  const rating = ratingSchema.safeParse(input.rating);
  if (!rating.success) throw new ReviewError("bad_rating", "Ratings go from 0 to 5 stars.");

  return getDb().transaction(async (tx: Tx) => {
    const [album] = await tx.select().from(albums).where(eq(albums.id, input.albumId)).limit(1);
    if (!album) throw new ReviewError("not_found", "That album doesn't exist.");

    if (input.clipTrackId) {
      const [track] = await tx
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(eq(tracks.id, input.clipTrackId), eq(tracks.albumId, album.id)))
        .limit(1);
      if (!track) throw new ReviewError("bad_clip", "That track isn't on this album.");
    }

    const existing = await findExisting(tx, authorId, album.id, input.reviewId);
    if (input.reviewId && (!existing || existing.albumId !== album.id)) {
      throw new ReviewError("not_found", "That review doesn't exist.");
    }

    const now = new Date();
    const published = input.status === "published";
    const values = {
      title: input.title,
      body: input.body,
      rating: rating.data,
      clipTrackId: input.clipTrackId,
      status: input.status,
      updatedAt: now,
    };

    let id: string;
    let slug: string;
    if (existing) {
      id = existing.id;
      slug = existing.slug;
      await tx
        .update(reviews)
        .set({ ...values, publishedAt: existing.publishedAt ?? (published ? now : null) })
        .where(eq(reviews.id, id));
    } else {
      slug = await uniqueSlug(tx, authorId, album.title);
      const [row] = await tx
        .insert(reviews)
        .values({
          ...values,
          albumId: album.id,
          authorId,
          slug,
          publishedAt: published ? now : null,
        })
        .returning({ id: reviews.id });
      id = row.id;
    }

    await replaceTags(tx, id, input.tags);
    await recomputeAlbumStats(tx, album.id);
    return { id, slug, status: input.status, albumId: album.id };
  });
}

/** Soft delete (recoverable by an admin for a while). Returns false if there was nothing to delete. */
export async function deleteReview(authorId: string, reviewId: string): Promise<boolean> {
  return getDb().transaction(async (tx: Tx) => {
    const [row] = await tx
      .update(reviews)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(reviews.id, reviewId), eq(reviews.authorId, authorId), isNull(reviews.deletedAt)),
      )
      .returning({ albumId: reviews.albumId });
    if (!row) return false;
    await recomputeAlbumStats(tx, row.albumId);
    return true;
  });
}

export type QuickLogResult =
  | { kind: "logged"; id: string }
  /** The author has an unpublished draft: the rating went into it, nothing was published. */
  | { kind: "draft"; id: string };

/**
 * One-click logging from the album page (S23): sets the author's rating (or null for "listened,
 * no rating"), creating a published rating-only log if they had nothing for this album.
 */
export async function setQuickRating(
  authorId: string,
  albumId: string,
  rating: number | null,
): Promise<QuickLogResult> {
  const parsed = ratingSchema.safeParse(rating);
  if (!parsed.success) throw new ReviewError("bad_rating", "Ratings go from 0 to 5 stars.");

  return getDb().transaction(async (tx: Tx) => {
    const [album] = await tx.select().from(albums).where(eq(albums.id, albumId)).limit(1);
    if (!album) throw new ReviewError("not_found", "That album doesn't exist.");
    const existing = await findExisting(tx, authorId, albumId);
    const now = new Date();

    if (existing) {
      await tx
        .update(reviews)
        .set({ rating: parsed.data, updatedAt: now })
        .where(eq(reviews.id, existing.id));
      await recomputeAlbumStats(tx, albumId);
      return { kind: existing.status === "published" ? "logged" : "draft", id: existing.id };
    }

    const slug = await uniqueSlug(tx, authorId, album.title);
    const [row] = await tx
      .insert(reviews)
      .values({
        albumId,
        authorId,
        slug,
        body: "",
        rating: parsed.data,
        status: "published",
        publishedAt: now,
      })
      .returning({ id: reviews.id });
    await recomputeAlbumStats(tx, albumId);
    return { kind: "logged", id: row.id };
  });
}

/** Removes a rating-only log. A review with text is never deleted this way. */
export async function removeLog(authorId: string, albumId: string): Promise<boolean> {
  return getDb().transaction(async (tx: Tx) => {
    const [row] = await tx
      .update(reviews)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(reviews.authorId, authorId),
          eq(reviews.albumId, albumId),
          isNull(reviews.deletedAt),
          sql`${reviews.body} = ''`,
        ),
      )
      .returning({ id: reviews.id });
    if (!row) return false;
    await recomputeAlbumStats(tx, albumId);
    return true;
  });
}
