"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { validateHandle } from "@/lib/auth/handles";
import { isUniqueViolation } from "@/lib/db-errors";
import { requireUser, safeRedirectPath } from "@/lib/auth/session";

export type OnboardingState = { errors?: { handle?: string; displayName?: string } };

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Please enter a name.")
  .max(50, "Keep it under 50 characters.");

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser({ allowIncomplete: true });
  if (user.handle) redirect("/"); // already onboarded

  const handle = validateHandle(String(formData.get("handle") ?? ""));
  const displayName = displayNameSchema.safeParse(formData.get("displayName"));
  if (!handle.ok || !displayName.success) {
    return {
      errors: {
        handle: handle.ok ? undefined : handle.error,
        displayName: displayName.success ? undefined : displayName.error.issues[0]?.message,
      },
    };
  }

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ handle: handle.handle, displayName: displayName.data })
        .where(eq(schema.users.id, user.id));
      await tx.insert(schema.profiles).values({ userId: user.id }).onConflictDoNothing();
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { errors: { handle: "That handle is taken." } };
    throw err;
  }

  redirect(safeRedirectPath(formData.get("redirectTo"), `/u/${handle.handle}`));
}
