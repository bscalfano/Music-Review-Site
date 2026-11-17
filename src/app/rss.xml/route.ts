import { siteConfig } from "@/config/site";
import { buildRssFeed, RSS_HEADERS } from "@/lib/rss";
import { getPublicReviewsForRss } from "@/lib/social/feed";

export const dynamic = "force-dynamic";

/** Site-wide feed: the latest written reviews from public accounts. */
export async function GET() {
  const items = await getPublicReviewsForRss({ limit: 30 });
  const xml = buildRssFeed({
    title: `${siteConfig.name}: recent reviews`,
    description: siteConfig.tagline,
    link: "/discover",
    self: "/rss.xml",
    items,
  });
  return new Response(xml, { headers: RSS_HEADERS });
}
