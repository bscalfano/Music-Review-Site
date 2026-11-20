"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { PinError, togglePin } from "@/lib/pins/service";

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
