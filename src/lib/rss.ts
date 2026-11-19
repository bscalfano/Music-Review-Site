import { siteConfig } from "@/config/site";
import { markdownExcerpt } from "@/lib/markdown/directives";
import type { FeedItem } from "@/lib/social/feed";

/** Escapes text for use inside XML. */
export function xmlEscape(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // characters XML forbids
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const abs = (path: string) => new URL(path, siteConfig.url).toString();

function stars(rating: number | null): string {
  if (rating === null) return "";
  return rating === 0 ? " (0 stars)" : ` (${rating / 2}/5)`;
}

/** An RSS 2.0 feed of written reviews. */
export function buildRssFeed(opts: {
  title: string;
  description: string;
  /** Path of the page this feed belongs to. */
  link: string;
  /** Path of the feed itself. */
  self: string;
  items: FeedItem[];
}): string {
  const items = opts.items
    .map((item) => {
      const url = abs(`/u/${item.author.handle}/${item.slug}`);
      const name = item.author.displayName ?? `@${item.author.handle}`;
      const title = `${item.album.title} · ${item.artistName}${stars(item.rating)}`;
      return `    <item>
      <title>${xmlEscape(title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      ${item.publishedAt ? `<pubDate>${item.publishedAt.toUTCString()}</pubDate>` : ""}
      <dc:creator>${xmlEscape(name)}</dc:creator>
      <description>${xmlEscape(markdownExcerpt(item.body, 500))}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xmlEscape(opts.title)}</title>
    <link>${xmlEscape(abs(opts.link))}</link>
    <description>${xmlEscape(opts.description)}</description>
    <language>en</language>
    <atom:link href="${xmlEscape(abs(opts.self))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

export const RSS_HEADERS = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
};
