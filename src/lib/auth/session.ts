import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { getDb, schema } from "@/db";
import type { Viewer } from "@/lib/social/visibility";

export type CurrentUser = typeof schema.users.$inferSelect;
export type OnboardedUser = CurrentUser & { handle: string };

export const isAdminRole = (role: CurrentUser["role"]) => role === "admin" || role === "owner";

/**
 * The signed-in user, freshly read from the database (once per request). Returns null for
 * anonymous visitors AND for suspended or deleted accounts, so a valid session cookie never
 * outlives a ban.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [user] = await getDb().select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!user || user.deletedAt || user.status !== "active") return null;
  return user;
});

export function toViewer(user: CurrentUser | null): Viewer {
  return user ? { id: user.id, isAdmin: isAdminRole(user.role) } : null;
}

/** Same-site relative paths only, so ?callbackUrl= can't be used as an open redirect. */
export function safeRedirectPath(input: unknown, fallback = "/"): string {
  if (typeof input !== "string") return fallback;
  if (!input.startsWith("/") || input.startsWith("//") || input.startsWith("/\\")) return fallback;
  return input;
}

/**
 * For pages and actions that need a signed-in user. Anonymous visitors go to the sign-in page;
 * users who haven't picked a handle yet go to onboarding (unless `allowIncomplete`).
 */
export async function requireUser(opts: {
  returnTo?: string;
  allowIncomplete: true;
}): Promise<CurrentUser>;
export async function requireUser(opts?: {
  returnTo?: string;
  allowIncomplete?: false;
}): Promise<OnboardedUser>;
export async function requireUser(
  opts: { returnTo?: string; allowIncomplete?: boolean } = {},
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user)
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(safeRedirectPath(opts.returnTo))}`);
  if (!user.handle && !opts.allowIncomplete) redirect("/onboarding");
  return user;
}

/** Admin/owner only. Anyone else gets a 404, so the existence of /admin isn't advertised. */
export async function requireAdmin(): Promise<OnboardedUser> {
  const user = await getCurrentUser();
  if (!user || !user.handle || !isAdminRole(user.role)) notFound();
  return user as OnboardedUser;
}
