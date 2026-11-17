import { siteConfig } from "@/config/site";
import { getProfileByHandle } from "@/lib/profiles/queries";
import { buildRssFeed, RSS_HEADERS } from "@/lib/rss";
import { getPublicReviewsForRss } from "@/lib/social/feed";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ handle: string }> };

/** One person's reviews. Private, suspended and deleted accounts have no feed (404). */
export async function GET(_req: Request, ctx: Ctx) {
  const { handle } = await ctx.params;
  const data = await getProfileByHandle(handle);
  const user = data?.user;
  if (!user || user.isPrivate || user.status !== "active" || user.deletedAt) {
    return new Response("Not found", { status: 404 });
  }
  const items = await getPublicReviewsForRss({ authorId: user.id, limit: 30 });
  const name = user.displayName ?? `@${user.handle}`;
  const xml = buildRssFeed({
    title: `${name} on ${siteConfig.name}`,
    description: user.bio ?? `Album reviews by ${name}`,
    link: `/u/${user.handle}`,
    self: `/u/${user.handle}/rss.xml`,
    items,
  });
  return new Response(xml, { headers: RSS_HEADERS });
}
