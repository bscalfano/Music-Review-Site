"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs";
import { deleteList, ListError, listInputSchema, saveList } from "@/lib/lists/service";
import { checkRateLimit, rateLimitMessage } from "@/lib/social/ratelimit";

export type SaveListResult =
  | { ok: true; id: string; slug: string; status: "draft" | "published"; handle: string }
  | { ok: false; message: string };

/** Creates or updates a list. `listId` null = new. Called directly from the editor. */
export async function saveListAction(
  listId: string | null,
  input: unknown,
): Promise<SaveListResult> {
  const user = await requireUser({ returnTo: "/write/list" });
  if (listId !== null && !z.uuid().safeParse(listId).success) {
    return { ok: false, message: "Invalid list." };
  }
  const parsed = listInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const limit = await checkRateLimit(user.id, "list");
  if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };

  try {
    kickJobs(); // new albums get their tracklists and covers in the background
    const saved = await saveList(user.id, listId, parsed.data);
    revalidatePath(`/u/${user.handle}`);
    revalidatePath(`/lists/${user.handle}/${saved.slug}`);
    return { ok: true, ...saved, handle: user.handle };
  } catch (err) {
    if (err instanceof ListError) return { ok: false, message: err.message };
    console.error("[lists] save failed", err);
    return { ok: false, message: "Something went wrong saving your list. Please try again." };
  }
}

export async function deleteListAction(listId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!z.uuid().safeParse(listId).success) return { ok: false };
  const ok = await deleteList(user.id, listId);
  if (ok) revalidatePath(`/u/${user.handle}`);
  return { ok };
}
