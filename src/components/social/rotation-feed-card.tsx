import Link from "next/link";
import { ClickableItem } from "@/components/social/clickable-item";
import { UserAvatar } from "@/components/user-avatar";
import { albumPath, artistPath } from "@/lib/albums/paths";
import type { RotationFeedItem } from "@/lib/social/shelf-feed";

/** Someone added an album to their "In rotation" list: a compact one-line row, like a rating-only log. */
export function RotationFeedCard({ rotation }: { rotation: RotationFeedItem }) {
  const name = rotation.author.displayName ?? `@${rotation.author.handle}`;
  return (
    <ClickableItem
      href={albumPath(rotation.album)}
      className="flex items-center gap-3 py-3 text-sm"
    >
      <Link href={`/u/${rotation.author.handle}`} aria-label={`${name}'s profile`}>
        <UserAvatar user={rotation.author} size={28} />
      </Link>
      <p className="min-w-0 flex-1">
        <Link href={`/u/${rotation.author.handle}`} className="font-semibold hover:underline">
          {name}
        </Link>{" "}
        added{" "}
        <Link href={albumPath(rotation.album)} className="font-medium hover:underline">
          {rotation.album.title}
        </Link>{" "}
        <span className="text-muted-foreground">
          by{" "}
          <Link href={artistPath({ slug: rotation.artistSlug })} className="hover:underline">
            {rotation.artistName}
          </Link>
        </span>{" "}
        to their rotation
      </p>
      <time
        dateTime={rotation.queuedAt.toISOString()}
        className="text-muted-foreground hidden text-xs sm:block"
      >
        {rotation.queuedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
      </time>
    </ClickableItem>
  );
}
