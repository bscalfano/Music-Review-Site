"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resetAlbumLinks } from "@/lib/albums/links";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs";
import { ratingSchema } from "@/lib/reviews/schema";
import { checkRateLimit, rateLimitMessage } from "@/lib/social/ratelimit";
import { removeLog, ReviewError, setQuickRating } from "@/lib/reviews/service";

export type QuickLogState = { ok: true; draft?: boolean } | { ok: false; message: string };

const albumIdSchema = z.uuid();

function refresh(handle: string) {
  revalidatePath(`/u/${handle}`);
  revalidatePath("/albums/[slug]", "page");
}

/** S23: click a star on the album page. `rating` null = "listened" with no stars. */
export async function quickRateAction(
  albumId: string,
  rating: number | null,
): Promise<QuickLogState> {
  const user = await requireUser();
  if (!albumIdSchema.safeParse(albumId).success || !ratingSchema.safeParse(rating).success) {
    return { ok: false, message: "That rating isn't valid." };
  }
  const limit = await checkRateLimit(user.id, "quickRate");
  if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };
  try {
    const res = await setQuickRating(user.id, albumId, rating);
    refresh(user.handle);
    return { ok: true, draft: res.kind === "draft" };
  } catch (err) {
    if (err instanceof ReviewError) return { ok: false, message: err.message };
    console.error("[quick-rate] failed", err);
    return { ok: false, message: "Couldn't save your rating. Please try again." };
  }
}

export async function removeLogAction(albumId: string): Promise<QuickLogState> {
  const user = await requireUser();
  if (!albumIdSchema.safeParse(albumId).success) return { ok: false, message: "Invalid album." };
  const removed = await removeLog(user.id, albumId);
  refresh(user.handle);
  return removed
    ? { ok: true }
    : { ok: false, message: "Only rating-only logs can be removed here." };
}

/** Admin "Fix links" (S13): forget the stored streaming links and look them up again. */
export async function fixLinksAction(albumId: string): Promise<{ ok: boolean }> {
  await requireAdmin();
  if (!albumIdSchema.safeParse(albumId).success) return { ok: false };
  await resetAlbumLinks(albumId);
  kickJobs();
  revalidatePath("/albums/[slug]", "page");
  return { ok: true };
}
