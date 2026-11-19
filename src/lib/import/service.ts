import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ImportMatch } from "@/db/schema/import";
import { ensureAlbum } from "@/lib/albums/ensure-album";
import { searchAlbums } from "@/lib/albums/search";
import { normalizeTags, ratingSchema, MAX_BODY } from "@/lib/reviews/schema";

/** Longest album title we keep while staging an imported post. */
const MAX_TITLE = 120;
import { ReviewError, saveReview } from "@/lib/reviews/service";
import { parseCaption, parsePostsJson } from "./instagram";

const { importItems } = schema;
export type ImportItem = typeof importItems.$inferSelect;

/** Adds posts from an export file. Posts already staged (same timestamp + caption) are ignored. */
export async function stageExport(
  ownerId: string,
  json: unknown,
): Promise<{ added: number; duplicates: number; skipped: number }> {
  const { posts, skipped } = parsePostsJson(json);
  if (posts.length === 0) return { added: 0, duplicates: 0, skipped };

  const db = getDb();
  let added = 0;
  // Chunked so a 2,000-post export doesn't build one enormous statement.
  for (let i = 0; i < posts.length; i += 200) {
    const chunk = posts.slice(i, i + 200).map((post) => {
      const parsed = parseCaption(post.caption);
      return {
        ownerId,
        sourceKey: post.sourceKey,
        caption: post.caption,
        postedAt: post.postedAt,
        imagePath: post.imagePath,
        title: null,
        body: parsed.body,
        rating: parsed.rating,
        tags: normalizeTags(parsed.hashtags).slice(0, 8),
      };
    });
    const rows = await db
      .insert(importItems)
      .values(chunk)
      .onConflictDoNothing({ target: [importItems.ownerId, importItems.sourceKey] })
      .returning({ id: importItems.id });
    added += rows.length;
  }
  return { added, duplicates: posts.length - added, skipped };
}

/**
 * Looks for albums matching the caption's headline guesses and stores up to five suggestions.
 * If exactly one hit scores clearly best, it is pre-selected. Pure suggestion: nothing is
 * published until the owner confirms.
 */
export async function suggestMatches(ownerId: string, itemId: string): Promise<ImportMatch[]> {
  const db = getDb();
  const [item] = await db
    .select()
    .from(importItems)
    .where(and(eq(importItems.id, itemId), eq(importItems.ownerId, ownerId)))
    .limit(1);
  if (!item) return [];

  const { candidates } = parseCaption(item.caption);
  const found = new Map<string, ImportMatch>();
  for (const c of candidates.slice(0, 2)) {
    try {
      const hits = await searchAlbums(`${c.artist} ${c.title}`, { remote: true, limit: 5 });
      for (const h of hits) {
        if (!found.has(h.mbid)) {
          found.set(h.mbid, {
            mbid: h.mbid,
            title: h.title,
            artist: h.artist.name,
            releaseDate: h.releaseDate,
          });
        }
      }
    } catch (err) {
      console.error("[import] match search failed", err);
    }
  }
  const matches = [...found.values()].slice(0, 5);
  await db
    .update(importItems)
    .set({
      matches,
      // Only fill in a choice the owner hasn't made themselves.
      albumMbid: item.albumMbid ?? bestMatch(candidates, matches),
    })
    .where(eq(importItems.id, itemId));
  return matches;
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The mbid of a match whose title and artist both equal a caption reading, if exactly one does. */
export function bestMatch(
  candidates: { artist: string; title: string }[],
  matches: ImportMatch[],
): string | null {
  const exact = matches.filter((m) =>
    candidates.some((c) => norm(c.title) === norm(m.title) && norm(c.artist) === norm(m.artist)),
  );
  return exact.length === 1 ? exact[0].mbid : null;
}

export type ItemEdit = {
  title: string | null;
  body: string;
  rating: number | null;
  albumMbid: string | null;
  tags: string[];
};

export async function updateItem(ownerId: string, itemId: string, edit: ItemEdit) {
  if (!ratingSchema.safeParse(edit.rating).success) throw new Error("Invalid rating.");
  if (edit.body.length > MAX_BODY) throw new Error("That text is too long.");
  const title = edit.title?.trim().slice(0, MAX_TITLE) || null;
  await getDb()
    .update(importItems)
    .set({
      title,
      body: edit.body,
      rating: edit.rating,
      albumMbid: edit.albumMbid,
      tags: normalizeTags(edit.tags).slice(0, 8),
      error: null,
    })
    .where(
      and(
        eq(importItems.id, itemId),
        eq(importItems.ownerId, ownerId),
        eq(importItems.status, "pending"),
      ),
    );
}

export async function setSkipped(ownerId: string, itemIds: string[], skipped: boolean) {
  if (itemIds.length === 0) return;
  await getDb()
    .update(importItems)
    .set({ status: skipped ? "skipped" : "pending" })
    .where(
      and(
        eq(importItems.ownerId, ownerId),
        inArray(importItems.id, itemIds),
        inArray(importItems.status, skipped ? ["pending"] : ["skipped"]),
      ),
    );
}

export type PublishOutcome = { id: string; ok: true } | { id: string; ok: false; message: string };

/**
 * Publishes confirmed items as reviews dated to the original post. Items without an album are
 * left alone; failures are recorded on the item and don't stop the rest. An album the owner
 * already reviewed is reported rather than overwritten.
 */
export async function publishItems(ownerId: string, itemIds: string[]): Promise<PublishOutcome[]> {
  const db = getDb();
  const items = itemIds.length
    ? await db
        .select()
        .from(importItems)
        .where(
          and(
            eq(importItems.ownerId, ownerId),
            inArray(importItems.id, itemIds),
            eq(importItems.status, "pending"),
          ),
        )
        .orderBy(asc(importItems.postedAt))
    : [];

  const outcomes: PublishOutcome[] = [];
  for (const item of items) {
    const fail = async (message: string) => {
      await db.update(importItems).set({ error: message }).where(eq(importItems.id, item.id));
      outcomes.push({ id: item.id, ok: false, message });
    };
    if (!item.albumMbid) {
      await fail("Pick an album first.");
      continue;
    }
    try {
      const album = await ensureAlbum(item.albumMbid);
      if (!album) {
        await fail("MusicBrainz doesn't know that album.");
        continue;
      }
      const [existing] = await db
        .select({ id: schema.reviews.id })
        .from(schema.reviews)
        .where(
          and(
            eq(schema.reviews.authorId, ownerId),
            eq(schema.reviews.albumId, album.id),
            sql`${schema.reviews.deletedAt} IS NULL`,
          ),
        )
        .limit(1);
      if (existing) {
        await fail("You already have a review of this album.");
        continue;
      }
      const saved = await saveReview(ownerId, {
        albumId: album.id,
        title: null,
        body: item.body,
        rating: item.rating,
        clipTrackId: null,
        tags: item.tags,
        status: "published",
        publishedAt: item.postedAt,
        importedFrom: "instagram",
      });
      await db
        .update(importItems)
        .set({ status: "imported", reviewId: saved.id, error: null })
        .where(eq(importItems.id, item.id));
      outcomes.push({ id: item.id, ok: true });
    } catch (err) {
      await fail(
        err instanceof ReviewError ? err.message : "Something went wrong publishing this one.",
      );
      if (!(err instanceof ReviewError)) console.error("[import] publish failed", err);
    }
  }
  return outcomes;
}

export type ImportCounts = { pending: number; skipped: number; imported: number };

export async function importCounts(ownerId: string): Promise<ImportCounts> {
  const rows = await getDb()
    .select({ status: importItems.status, n: sql<number>`count(*)::int` })
    .from(importItems)
    .where(eq(importItems.ownerId, ownerId))
    .groupBy(importItems.status);
  const counts: ImportCounts = { pending: 0, skipped: 0, imported: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

/** Items in one state, oldest post first (the order the owner posted them). */
export async function listItems(
  ownerId: string,
  status: "pending" | "skipped" | "imported",
  limit = 25,
  offset = 0,
) {
  const rows = await getDb()
    .select()
    .from(importItems)
    .where(and(eq(importItems.ownerId, ownerId), eq(importItems.status, status)))
    .orderBy(asc(importItems.postedAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

/** Wipes the staging area (only un-published rows); published reviews are untouched. */
export async function clearStaged(ownerId: string): Promise<void> {
  await getDb()
    .delete(importItems)
    .where(
      and(eq(importItems.ownerId, ownerId), inArray(importItems.status, ["pending", "skipped"])),
    );
}
