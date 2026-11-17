"use server";

import { signOut } from "@/auth";
import { requireUser } from "@/lib/auth/session";
import { requestAccountDeletion } from "@/lib/account/account";

/**
 * Deletes the account after a typed confirmation of the handle. The account vanishes from the
 * site at once and is erased for good after the grace period; signing in again restores it.
 */
export async function deleteAccountAction(
  confirmation: string,
): Promise<{ ok: false; message: string } | never> {
  const user = await requireUser();
  if (confirmation.trim().toLowerCase().replace(/^@/, "") !== user.handle) {
    return { ok: false, message: `Type your handle (${user.handle}) to confirm.` };
  }
  try {
    await requestAccountDeletion(user.id);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Couldn't delete your account.",
    };
  }
  await signOut({ redirectTo: "/?deleted=1" });
  return { ok: false, message: "Signed out." }; // not reached: signOut redirects
}
