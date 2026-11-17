"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import {
  hideReview,
  removeComment,
  resetUserImage,
  restoreComment,
  setUserRole,
  suspendUser,
  unhideReview,
  unsuspendUser,
  type Moderator,
} from "@/lib/moderation/service";
import { resolveReports } from "@/lib/moderation/reports";
import { SocialError } from "@/lib/social/follows";

const id = z.uuid();
type Result = { ok: true; message?: string } | { ok: false; message: string };

async function moderator(): Promise<Moderator> {
  const admin = await requireAdmin();
  return { id: admin.id, role: admin.role };
}

async function run(fn: () => Promise<Result | void>): Promise<Result> {
  try {
    const result = await fn();
    // Moderation changes what everyone sees, so drop cached pages broadly.
    revalidatePath("/", "layout");
    return result ?? { ok: true };
  } catch (err) {
    if (err instanceof SocialError) return { ok: false, message: err.message };
    console.error("[admin] action failed", err);
    return { ok: false, message: "Something went wrong." };
  }
}

export type ReportDecision = "dismiss" | "hide_content" | "suspend_author";

/** One button on a reported item in the queue. */
export async function handleReportAction(
  targetType: "review" | "comment" | "user",
  targetId: string,
  decision: ReportDecision,
  note?: string,
): Promise<Result> {
  const mod = await moderator();
  if (!id.safeParse(targetId).success) return { ok: false, message: "Invalid target." };
  return run(async () => {
    const db = getDb();
    if (decision === "dismiss") {
      await resolveReports(mod.id, targetType, targetId, "dismissed");
      return;
    }

    if (decision === "hide_content") {
      if (targetType === "review") await hideReview(mod, targetId, note);
      else if (targetType === "comment") await removeComment(mod, targetId, note);
      else throw new SocialError("invalid", "Accounts are suspended, not hidden.");
      await resolveReports(mod.id, targetType, targetId, "actioned");
      return;
    }

    // suspend_author: the account itself, or the author of the reported review/comment
    let authorId = targetId;
    if (targetType === "review") {
      const [r] = await db
        .select({ a: schema.reviews.authorId })
        .from(schema.reviews)
        .where(eq(schema.reviews.id, targetId));
      authorId = r?.a ?? "";
    } else if (targetType === "comment") {
      const [c] = await db
        .select({ a: schema.comments.authorId })
        .from(schema.comments)
        .where(eq(schema.comments.id, targetId));
      authorId = c?.a ?? "";
    }
    if (!authorId) throw new SocialError("not_found", "That content no longer exists.");
    await suspendUser(mod, authorId, note);
    if (targetType === "review") await hideReview(mod, targetId, note);
    if (targetType === "comment") await removeComment(mod, targetId, note);
    await resolveReports(mod.id, targetType, targetId, "actioned");
  });
}

export async function unhideReviewAction(reviewId: string): Promise<Result> {
  const mod = await moderator();
  if (!id.safeParse(reviewId).success) return { ok: false, message: "Invalid review." };
  return run(async () => {
    await unhideReview(mod, reviewId);
  });
}

export async function restoreCommentAction(commentId: string): Promise<Result> {
  const mod = await moderator();
  if (!id.safeParse(commentId).success) return { ok: false, message: "Invalid comment." };
  return run(async () => {
    await restoreComment(mod, commentId);
  });
}

export async function suspendUserAction(userId: string, note?: string): Promise<Result> {
  const mod = await moderator();
  if (!id.safeParse(userId).success) return { ok: false, message: "Invalid user." };
  return run(() => suspendUser(mod, userId, note));
}

export async function unsuspendUserAction(userId: string): Promise<Result> {
  const mod = await moderator();
  if (!id.safeParse(userId).success) return { ok: false, message: "Invalid user." };
  return run(() => unsuspendUser(mod, userId));
}

export async function resetImageAction(userId: string, kind: "avatar" | "banner"): Promise<Result> {
  const mod = await moderator();
  if (!id.safeParse(userId).success || (kind !== "avatar" && kind !== "banner")) {
    return { ok: false, message: "Invalid request." };
  }
  return run(() => resetUserImage(mod, userId, kind));
}

export async function setRoleAction(userId: string, role: "admin" | "member"): Promise<Result> {
  const mod = await moderator();
  if (!id.safeParse(userId).success || (role !== "admin" && role !== "member")) {
    return { ok: false, message: "Invalid request." };
  }
  return run(() => setUserRole(mod, userId, role));
}
