"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureAlbum } from "@/lib/albums/ensure-album";
import { requireUser } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs";
import {
  addToQueue,
  removeFromQueue,
  respondToSuggestion,
  suggestAlbum,
} from "@/lib/queue/service";
import { SocialError } from "@/lib/social/follows";

type Result = { ok: true; message?: string } | { ok: false; message: string };

const id = z.uuid();

function failure(err: unknown): Result {
  if (err instanceof SocialError) return { ok: false, message: err.message };
  console.error("[queue] action failed", err);
  return { ok: false, message: "Something went wrong. Please try again." };
}

function refresh(handle: string | null) {
  if (handle) revalidatePath(`/u/${handle}`);
  revalidatePath("/albums/[slug]", "page");
}

/** "Add to my queue" from an album page or the queue tab. Takes the MusicBrainz id. */
export async function addToQueueAction(albumMbid: string, note?: string): Promise<Result> {
  const user = await requireUser();
  if (!id.safeParse(albumMbid).success) return { ok: false, message: "Invalid album." };
  try {
    const album = await ensureAlbum(albumMbid);
    if (!album) return { ok: false, message: "We couldn't find that album." };
    kickJobs();
    const res = await addToQueue(user.id, album.id, note);
    refresh(user.handle);
    if (res === "already_reviewed") {
      return { ok: false, message: "You've already reviewed that one." };
    }
    return { ok: true, message: res === "already_queued" ? "Already in your queue." : "Added." };
  } catch (err) {
    return failure(err);
  }
}

export async function removeFromQueueAction(albumId: string): Promise<Result> {
  const user = await requireUser();
  if (!id.safeParse(albumId).success) return { ok: false, message: "Invalid album." };
  await removeFromQueue(user.id, albumId);
  refresh(user.handle);
  return { ok: true };
}

/** Suggest an album (by MusicBrainz id) for someone else's queue. */
export async function suggestAlbumAction(
  ownerId: string,
  albumMbid: string,
  note?: string,
): Promise<Result> {
  const user = await requireUser();
  if (!id.safeParse(ownerId).success || !id.safeParse(albumMbid).success) {
    return { ok: false, message: "Invalid request." };
  }
  try {
    const album = await ensureAlbum(albumMbid);
    if (!album) return { ok: false, message: "We couldn't find that album." };
    kickJobs();
    const res = await suggestAlbum(user.id, ownerId, album.id, note);
    if (res === "already_reviewed") {
      return { ok: false, message: "They've already reviewed that one." };
    }
    if (res === "already_queued") {
      return { ok: false, message: "That's already in their queue or suggestions." };
    }
    return { ok: true, message: "Suggestion sent." };
  } catch (err) {
    return failure(err);
  }
}

export async function respondToSuggestionAction(itemId: string, accept: boolean): Promise<Result> {
  const user = await requireUser();
  if (!id.safeParse(itemId).success) return { ok: false, message: "Invalid suggestion." };
  try {
    const done = await respondToSuggestion(user.id, itemId, accept);
    refresh(user.handle);
    revalidatePath("/notifications");
    return done ? { ok: true } : { ok: false, message: "That suggestion is no longer there." };
  } catch (err) {
    return failure(err);
  }
}
