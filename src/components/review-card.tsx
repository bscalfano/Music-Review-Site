import Link from "next/link";
import { StarRating } from "@/components/star-rating";
import { UserAvatar } from "@/components/user-avatar";
import { markdownExcerpt } from "@/lib/markdown/directives";
import type { ReviewCardData } from "@/lib/reviews/queries";

/** A review as a short card: reviewer, stars, date, an excerpt and a "Read more" link. */
export function ReviewCard({
  review,
  excerptLength = 400,
}: {
  review: ReviewCardData;
  excerptLength?: number;
}) {
  const href = `/u/${review.author.handle}/${review.slug}`;
  const excerpt = markdownExcerpt(review.body, excerptLength);
  const truncated = excerpt.endsWith("…");
  const name = review.author.displayName ?? `@${review.author.handle}`;
  return (
    <article className="flex gap-3 py-4">
      <Link
        href={`/u/${review.author.handle}`}
        className="shrink-0"
        aria-label={`${name}'s profile`}
      >
        <UserAvatar user={review.author} size={40} />
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            href={`/u/${review.author.handle}`}
            className="text-sm font-semibold hover:underline"
          >
            {name}
          </Link>
          <StarRating rating={review.rating} size={14} />
          {review.publishedAt && (
            <time
              dateTime={review.publishedAt.toISOString()}
              className="text-muted-foreground text-xs"
            >
              {review.publishedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
            </time>
          )}
        </div>
        {review.title && (
          <h3 className="font-semibold">
            <Link href={href} className="hover:underline">
              {review.title}
            </Link>
          </h3>
        )}
        <p className="text-sm leading-relaxed">
          {excerpt}{" "}
          {truncated && (
            <Link
              href={href}
              className="text-muted-foreground font-medium underline underline-offset-2"
            >
              Read more
            </Link>
          )}
        </p>
        {review.hearts > 0 && <p className="text-muted-foreground text-xs">♥ {review.hearts}</p>}
      </div>
    </article>
  );
}
