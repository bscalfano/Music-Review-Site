import { timingSafeEqual } from "node:crypto";
import { deleteExpiredCacheEntries } from "@/lib/music/cache";
import { runDueJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // refuse to run unauthenticated if the secret was never set
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` to the paths listed in vercel.json. */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const summary = await runDueJobs({ budgetMs: 45_000, maxJobs: 50 });
  await deleteExpiredCacheEntries();
  return Response.json(summary);
}
