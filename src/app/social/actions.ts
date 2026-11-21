"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser, isAdminRole } from "@/lib/auth/session";
import { blockUser, unblockUser } from "@/lib/social/blocks";
import { addComment, deleteComment, editComment } from "@/lib/social/comments";
import {
  followUser,
  removeFollower,
  respondToFollowRequest,
  SocialError,
  unfollowUser,
} from "@/lib/social/follows";
import { kickJobs } from "@/lib/jobs";
import {
  markAllRead,
  NOTIFICATION_LABELS,
  type NotificationType,
} from "@/lib/social/notifications";
import { muteUser, unmuteUser } from "@/lib/social/mutes";
import { toggleHeart } from "@/lib/social/reactions";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import type { FollowState } from "@/lib/social/visibility";

const id = z.uuid();

type Fail = { ok: false; message: string };
const fail = (message: string): Fail => ({ ok: false, message });

/** Turns expected failures (SocialError) into a message; anything else is logged and generic. */
function toFail(err: unknown): Fail {
  if (err instanceof SocialError) return fail(err.message);
  console.error("[social] action failed", err);
  return fail("Something went wrong. Please try again.");
}

async function actor() {
  const user = await requireUser();
  return { user, actor: { id: user.id, isAdmin: isAdminRole(user.role) } };
}

// --- Following ------------------------------------------------------------------------------

export async function followAction(
  targetId: string,
): Promise<{ ok: true; state: FollowState } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(targetId).success) return fail("Invalid user.");
  try {
    const state = await followUser(user.id, targetId);
    kickJobs();
    revalidatePath("/", "layout");
    return { ok: true, state };
  } catch (err) {
    return toFail(err);
  }
}

export async function unfollowAction(targetId: string): Promise<{ ok: true } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(targetId).success) return fail("Invalid user.");
  try {
    await unfollowUser(user.id, targetId);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function respondToRequestAction(
  followerId: string,
  accept: boolean,
): Promise<{ ok: true } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(followerId).success) return fail("Invalid user.");
  try {
    const done = await respondToFollowRequest(user.id, followerId, accept);
    kickJobs();
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return done ? { ok: true } : fail("That request is no longer pending.");
  } catch (err) {
    return toFail(err);
  }
}

export async function removeFollowerAction(followerId: string): Promise<{ ok: true } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(followerId).success) return fail("Invalid user.");
  await removeFollower(user.id, followerId);
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Blocking -------------------------------------------------------------------------------

export async function blockAction(targetId: string): Promise<{ ok: true } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(targetId).success) return fail("Invalid user.");
  try {
    await blockUser(user.id, targetId);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function unblockAction(targetId: string): Promise<{ ok: true } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(targetId).success) return fail("Invalid user.");
  await unblockUser(user.id, targetId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function muteAction(targetId: string): Promise<{ ok: true } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(targetId).success) return fail("Invalid user.");
  try {
    await muteUser(user.id, targetId);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function unmuteAction(targetId: string): Promise<{ ok: true } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(targetId).success) return fail("Invalid user.");
  await unmuteUser(user.id, targetId);
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Comments and hearts --------------------------------------------------------------------

export async function addCommentAction(
  reviewId: string,
  body: string,
  parentId: string | null,
  reviewPath: string,
): Promise<{ ok: true; id: string } | Fail> {
  const { actor: a } = await actor();
  if (!id.safeParse(reviewId).success) return fail("Invalid review.");
  if (parentId !== null && !id.safeParse(parentId).success) return fail("Invalid comment.");
  try {
    const commentId = await addComment(a, reviewId, body, parentId);
    kickJobs();
    if (reviewPath.startsWith("/u/")) revalidatePath(reviewPath);
    return { ok: true, id: commentId };
  } catch (err) {
    return toFail(err);
  }
}

export async function editCommentAction(
  commentId: string,
  body: string,
  reviewPath: string,
): Promise<{ ok: true } | Fail> {
  const { user } = await actor();
  if (!id.safeParse(commentId).success) return fail("Invalid comment.");
  try {
    await editComment(user.id, commentId, body);
    if (reviewPath.startsWith("/u/")) revalidatePath(reviewPath);
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function deleteCommentAction(
  commentId: string,
  reviewPath: string,
): Promise<{ ok: true } | Fail> {
  const { actor: a } = await actor();
  if (!id.safeParse(commentId).success) return fail("Invalid comment.");
  try {
    await deleteComment(a, commentId);
    if (reviewPath.startsWith("/u/")) revalidatePath(reviewPath);
    return { ok: true };
  } catch (err) {
    return toFail(err);
  }
}

export async function toggleHeartAction(
  targetType: "review" | "comment",
  targetId: string,
): Promise<{ ok: true; hearted: boolean; count: number } | Fail> {
  const { actor: a } = await actor();
  if (!id.safeParse(targetId).success) return fail("Invalid target.");
  try {
    const result = await toggleHeart(a, targetType, targetId);
    kickJobs();
    return { ok: true, ...result };
  } catch (err) {
    return toFail(err);
  }
}

// --- Notifications --------------------------------------------------------------------------

export async function markNotificationsReadAction(): Promise<void> {
  const { user } = await actor();
  await markAllRead(user.id);
  revalidatePath("/", "layout");
}

const prefsSchema = z.array(
  z.enum(Object.keys(NOTIFICATION_LABELS) as [NotificationType, ...NotificationType[]]),
);

export async function updateEmailNotificationsAction(
  types: string[],
): Promise<{ ok: boolean; message: string }> {
  const { user } = await actor();
  const parsed = prefsSchema.safeParse(types);
  if (!parsed.success) return { ok: false, message: "Unknown notification type." };
  await getDb()
    .update(schema.users)
    .set({ emailNotifications: [...new Set(parsed.data)] })
    .where(eq(schema.users.id, user.id));
  revalidatePath("/settings");
  return { ok: true, message: "Email preferences saved." };
}

export async function updateAcceptSuggestionsAction(
  accept: boolean,
): Promise<{ ok: boolean; message: string }> {
  const { user } = await actor();
  await getDb()
    .update(schema.users)
    .set({ acceptSuggestions: !!accept })
    .where(eq(schema.users.id, user.id));
  revalidatePath("/settings");
  revalidatePath(`/u/${user.handle}`);
  return {
    ok: true,
    message: accept ? "People can suggest albums." : "Suggestions are off.",
  };
}
