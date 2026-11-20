"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  getPinCandidates,
  PinError,
  reorderPins,
  togglePin,
  type PinCandidate,
} from "@/lib/pins/service";

export async function togglePinAction(
  kind: "review" | "shelf",
  id: string,
): Promise<{ ok: true; pinned: boolean } | { ok: false; message: string }> {
  const user = await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Invalid item." };
  try {
    const { pinned } = await togglePin(user.id, kind, id);
    revalidatePath("/", "layout");
    return { ok: true, pinned };
  } catch (err) {
    if (err instanceof PinError) return { ok: false, message: err.message };
    console.error("[pins] toggle failed", err);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function reorderPinsAction(
  reviewIds: string[],
  shelfIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await requireUser();
  const ids = z.array(z.uuid()).max(10);
  if (!ids.safeParse(reviewIds).success || !ids.safeParse(shelfIds).success) {
    return { ok: false, message: "Invalid order." };
  }
  try {
    await reorderPins(user.id, "review", reviewIds);
    await reorderPins(user.id, "shelf", shelfIds);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    if (err instanceof PinError) return { ok: false, message: err.message };
    console.error("[pins] reorder failed", err);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function listPinCandidatesAction(
  kind: "review" | "shelf",
): Promise<{ ok: true; items: PinCandidate[] } | { ok: false; message: string }> {
  const user = await requireUser();
  try {
    return { ok: true, items: await getPinCandidates(user.id, kind) };
  } catch (err) {
    console.error("[pins] candidates failed", err);
    return { ok: false, message: "Couldn't load your list. Please try again." };
  }
}
