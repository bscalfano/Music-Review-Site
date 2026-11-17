import { buildDataExport } from "@/lib/account/account";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimit, rateLimitMessage } from "@/lib/social/ratelimit";

export const dynamic = "force-dynamic";

/** "Download my data": everything we store about the signed-in user, as one JSON file. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });

  const limit = await checkRateLimit(user.id, "export");
  if (!limit.ok) return new Response(rateLimitMessage(limit), { status: 429 });

  const data = await buildDataExport(user.id);
  if (!data) return new Response("Not found", { status: 404 });

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${user.handle ?? "account"}-data.json"`,
      "Cache-Control": "no-store",
    },
  });
}
