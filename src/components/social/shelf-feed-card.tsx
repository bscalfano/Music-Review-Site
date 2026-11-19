import Link from "next/link";
import { MiniShelf } from "@/components/lists/shelf-row";
import { UserAvatar } from "@/components/user-avatar";
import type { ShelfFeedItem } from "@/lib/social/shelf-feed";

/** A shelf someone just published, in the Following feed: who, the title, and the records on it. */
export function ShelfFeedCard({ shelf }: { shelf: ShelfFeedItem }) {
  const name = shelf.author.displayName ?? `@${shelf.author.handle}`;
  const href = `/shelves/${shelf.author.handle}/${shelf.slug}`;
  return (
    <li className="py-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link
          href={`/u/${shelf.author.handle}`}
          className="flex items-center gap-2 font-semibold hover:underline"
        >
          <UserAvatar user={shelf.author} size={24} />
          {name}
        </Link>
        <span className="text-muted-foreground">made a shelf</span>
        <time dateTime={shelf.publishedAt.toISOString()} className="text-muted-foreground text-xs">
          {shelf.publishedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
        </time>
      </div>
      <Link href={href} className="group mt-3 block max-w-sm">
        <MiniShelf covers={shelf.covers} />
        <p className="mt-2 font-semibold group-hover:underline">{shelf.title}</p>
        <p className="text-muted-foreground text-xs">
          {shelf.itemCount} {shelf.itemCount === 1 ? "album" : "albums"}
          {shelf.year ? ` · ${shelf.year}` : ""}
        </p>
      </Link>
      {shelf.description && (
        <p className="text-muted-foreground mt-1 line-clamp-2 max-w-prose text-sm">
          {shelf.description}
        </p>
      )}
    </li>
  );
}
