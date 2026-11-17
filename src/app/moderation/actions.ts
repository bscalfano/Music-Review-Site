"use server";

import { requireUser, isAdminRole } from "@/lib/auth/session";
import { createReport, reportInputSchema } from "@/lib/moderation/reports";
import { SocialError } from "@/lib/social/follows";

export type ReportResult = { ok: true; created: boolean } | { ok: false; message: string };

/** "Report" on a review, comment or profile. Anyone signed in can report what they can see. */
export async function reportAction(input: unknown): Promise<ReportResult> {
  const user = await requireUser();
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  try {
    const { created } = await createReport(
      { id: user.id, isAdmin: isAdminRole(user.role) },
      parsed.data,
    );
    return { ok: true, created };
  } catch (err) {
    if (err instanceof SocialError) return { ok: false, message: err.message };
    console.error("[report] failed", err);
    return { ok: false, message: "Couldn't send your report. Please try again." };
  }
}
