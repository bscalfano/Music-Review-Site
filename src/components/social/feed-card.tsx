import { MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ClickableItem } from "@/components/social/clickable-item";
import { ClipButton } from "@/components/clip-button";
import { HeartButton } from "@/components/social/heart-button";
import { StarRating } from "@/components/star-rating";
import { UserAvatar } from "@/components/user-avatar";
import { albumPath, artistPath } from "@/lib/albums/paths";
import { markdownExcerpt } from "@/lib/markdown/directives";
import { albumCoverUrl } from "@/lib/music";
import type { FeedItem } from "@/lib/social/feed";

function date(d: Date | null) {
  return d ? d.toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
}

/**
 * One entry in the feed. Written reviews are full cards (cover, reviewer, stars, ~280 characters,
 * the clip); rating-only logs (S23) are a compact one-line row.
 */
export function FeedCard({ item }: { item: FeedItem }) {
  const name = item.author.displayName ?? `@${item.author.handle}`;
  const reviewHref = `/u/${item.author.handle}/${item.slug}`;
  const heart = (
    <HeartButton
      targetType="review"
      targetId={item.id}
      count={item.hearts}
      hearted={item.viewerHearted ?? false}
      label={`review of ${item.album.title} by ${name}`}
      signInHref={
        item.viewerHearted === null
          ? `/sign-in?callbackUrl=${encodeURIComponent(reviewHref)}`
          : undefined
      }
    />
  );

  if (item.body.trim() === "") {
    return (
      <ClickableItem href={reviewHref} className="flex items-center gap-3 py-3 text-sm">
        <Link href={`/u/${item.author.handle}`} aria-label={`${name}'s profile`}>
          <UserAvatar user={item.author} size={28} />
        </Link>
        <p className="min-w-0 flex-1">
          <Link href={`/u/${item.author.handle}`} className="font-semibold hover:underline">
            {name}
          </Link>{" "}
          {item.rating === null ? "listened to" : "rated"}{" "}
          <Link href={albumPath(item.album)} className="font-medium hover:underline">
            {item.album.title}
          </Link>{" "}
          <span className="text-muted-foreground">
            by{" "}
            <Link href={artistPath({ slug: item.artistSlug })} className="hover:underline">
              {item.artistName}
            </Link>
          </span>
        </p>
        <StarRating rating={item.rating} size={14} />
        {heart}
        <time
          dateTime={item.publishedAt?.toISOString()}
          className="text-muted-foreground hidden text-xs sm:block"
        >
          {date(item.publishedAt)}
        </time>
      </ClickableItem>
    );
  }

  const excerpt = markdownExcerpt(item.body, 280);
  return (
    <ClickableItem href={reviewHref} className="flex gap-4 py-5">
      <Link
        href={albumPath(item.album)}
        className="bg-muted relative block size-24 shrink-0 overflow-hidden rounded-lg sm:size-32"
      >
        <Image
          src={albumCoverUrl(item.album, 250)}
          alt={`Album cover of ${item.album.title} by ${item.artistName}`}
          fill
          sizes="128px"
          unoptimized
          className="object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Link
            href={`/u/${item.author.handle}`}
            className="flex items-center gap-2 font-semibold hover:underline"
          >
            <UserAvatar user={item.author} size={24} />
            {name}
          </Link>
          <time
            dateTime={item.publishedAt?.toISOString()}
            className="text-muted-foreground text-xs"
          >
            {date(item.publishedAt)}
          </time>
        </div>
        <h2 className="leading-snug font-semibold">
          <Link href={albumPath(item.album)} className="hover:underline">
            {item.album.title}
          </Link>
          <span className="text-muted-foreground font-normal">
            {" "}
            ·{" "}
            <Link href={artistPath({ slug: item.artistSlug })} className="hover:underline">
              {item.artistName}
            </Link>
          </span>
        </h2>
        <StarRating rating={item.rating} size={16} />
        <p className="text-sm leading-relaxed">
          {excerpt}{" "}
          {excerpt.endsWith("…") && (
            <Link
              href={reviewHref}
              className="text-muted-foreground font-medium underline underline-offset-2"
            >
              Read more
            </Link>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {item.clip && (
            <ClipButton
              trackId={item.clip.trackId}
              previewUrl={item.clip.previewUrl}
              label={item.clip.title}
            />
          )}
          <span className="text-muted-foreground -ml-2 flex items-center gap-3 text-xs">
            {heart}
            {item.comments > 0 && (
              <Link
                href={`${reviewHref}#comments`}
                className="flex items-center gap-1 hover:underline"
              >
                <MessageCircle className="size-3.5" aria-hidden /> {item.comments}
              </Link>
            )}
          </span>
        </div>
      </div>
    </ClickableItem>
  );
}
