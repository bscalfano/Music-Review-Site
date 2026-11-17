"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs";
import {
  clearStaged,
  publishItems,
  setSkipped,
  stageExport,
  suggestMatches,
  updateItem,
  type PublishOutcome,
} from "@/lib/import/service";
import { ratingSchema } from "@/lib/reviews/schema";

/** Vercel rejects request bodies over ~4.5 MB; bigger exports use `pnpm import:instagram`. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export type UploadState = { ok: boolean; message: string } | null;

export async function uploadExportAction(_prev: UploadState, form: FormData): Promise<UploadState> {
  const owner = await requireOwner();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose your posts_1.json file first." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: "That file is over 4 MB. Use `pnpm import:instagram <file>` from your computer.",
    };
  }
  try {
    const json: unknown = JSON.parse(await file.text());
    const res = await stageExport(owner.id, json);
    revalidatePath("/admin/import");
    const parts = [`Added ${res.added} post${res.added === 1 ? "" : "s"}`];
    if (res.duplicates) parts.push(`${res.duplicates} already there`);
    if (res.skipped) parts.push(`${res.skipped} skipped (no date)`);
    return { ok: true, message: parts.join(", ") + "." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof SyntaxError ? "That file isn't valid JSON." : (err as Error).message,
    };
  }
}

const id = z.uuid();

export async function suggestAction(itemId: string) {
  const owner = await requireOwner();
  if (!id.safeParse(itemId).success) return { matches: [] };
  const matches = await suggestMatches(owner.id, itemId);
  revalidatePath("/admin/import");
  return { matches };
}

const editSchema = z.object({
  title: z.string().max(200).nullable(),
  body: z.string().max(20_000),
  rating: ratingSchema,
  albumMbid: z.uuid().nullable(),
  tags: z.array(z.string().max(60)).max(20),
});

export async function saveItemAction(itemId: string, edit: unknown): Promise<{ ok: boolean }> {
  const owner = await requireOwner();
  const parsed = editSchema.safeParse(edit);
  if (!id.safeParse(itemId).success || !parsed.success) return { ok: false };
  await updateItem(owner.id, itemId, parsed.data);
  return { ok: true };
}

export async function skipAction(itemIds: string[], skipped: boolean) {
  const owner = await requireOwner();
  await setSkipped(owner.id, z.array(z.uuid()).max(500).parse(itemIds), skipped);
  revalidatePath("/admin/import");
}

export async function publishAction(itemIds: string[]): Promise<PublishOutcome[]> {
  const owner = await requireOwner();
  const ids = z.array(z.uuid()).max(100).parse(itemIds);
  kickJobs();
  const outcomes = await publishItems(owner.id, ids);
  revalidatePath("/admin/import");
  revalidatePath(`/u/${owner.handle}`);
  revalidatePath("/albums/[slug]", "page");
  return outcomes;
}

export async function clearStagedAction() {
  const owner = await requireOwner();
  await clearStaged(owner.id);
  revalidatePath("/admin/import");
}
