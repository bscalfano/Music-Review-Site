"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureAlbum } from "@/lib/albums/ensure-album";
import { requireUser } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs";
import { reviewInputSchema } from "@/lib/reviews/schema";
import { checkRateLimit, rateLimitMessage } from "@/lib/social/ratelimit";
import { deleteReview, ReviewError, saveReview } from "@/lib/reviews/service";

export type SaveReviewResult =
  | { ok: true; id: string; slug: string; status: "draft" | "published"; handle: string }
  | { ok: false; message: string; errors?: Record<string, string> };

function revalidateReviewPaths(handle: string, slug: string) {
  revalidatePath(`/u/${handle}`);
  revalidatePath(`/u/${handle}/${slug}`);
  revalidatePath("/albums/[slug]", "page");
}

/** Saves a draft or publishes. Called directly from the editor with a plain object. */
export async function saveReviewAction(input: unknown): Promise<SaveReviewResult> {
  const user = await requireUser({ returnTo: "/write" });
  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, message: Object.values(errors)[0] ?? "Check the form.", errors };
  }
  const data = parsed.data;

  if (data.status === "published") {
    const limit = await checkRateLimit(user.id, "publish");
    if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };
  }

  try {
    const album = await ensureAlbum(data.albumMbid);
    if (!album) return { ok: false, message: "We couldn't find that album." };
    kickJobs();
    const saved = await saveReview(user.id, { ...data, albumId: album.id });
    revalidateReviewPaths(user.handle, saved.slug);
    return { ok: true, id: saved.id, slug: saved.slug, status: saved.status, handle: user.handle };
  } catch (err) {
    if (err instanceof ReviewError) return { ok: false, message: err.message };
    console.error("[write] save failed", err);
    return { ok: false, message: "Something went wrong saving your review. Please try again." };
  }
}

export async function deleteReviewAction(reviewId: string): Promise<{ ok: boolean }> {
  const user = await requireUser({ returnTo: "/write" });
  if (!z.uuid().safeParse(reviewId).success) return { ok: false };
  const ok = await deleteReview(user.id, reviewId);
  if (ok) {
    revalidatePath(`/u/${user.handle}`);
    revalidatePath("/albums/[slug]", "page");
  }
  return { ok };
}
