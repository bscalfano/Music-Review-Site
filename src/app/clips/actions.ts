"use server";

import { z } from "zod";
import { resolveTrackPreview } from "@/lib/albums/previews";

const inputSchema = z.object({ trackId: z.uuid(), force: z.boolean().optional() });

/** Returns a playable clip URL for a track, looking one up if the stored one is missing/expired. */
export async function resolveClipAction(
  trackId: string,
  force = false,
): Promise<{ url: string | null }> {
  const parsed = inputSchema.safeParse({ trackId, force });
  if (!parsed.success) return { url: null };
  try {
    return { url: await resolveTrackPreview(parsed.data.trackId, { force: parsed.data.force }) };
  } catch (err) {
    console.error("[clips] resolve failed", err);
    return { url: null };
  }
}
