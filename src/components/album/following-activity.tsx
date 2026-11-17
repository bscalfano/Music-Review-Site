import { AlignLeft, Bookmark } from "lucide-react";
import Link from "next/link";
import { StarRating } from "@/components/star-rating";
import { UserAvatar } from "@/components/user-avatar";
import { ratingLabel } from "@/components/star-rating";
import { cn } from "@/lib/utils";
import type { ActivityPerson, FollowingActivity } from "@/lib/social/album-activity";

const MAX_DESKTOP = 16;
const MAX_MOBILE = 8;

function tooltip(p: ActivityPerson): string {
  const when = p.at.toLocaleDateString("en-US", { dateStyle: "medium" });
  if (p.kind === "queue") return `@${p.handle} · in their queue`;
  const stars = p.rating === null ? "listened" : ratingLabel(p.rating);
  return `@${p.handle} · ${stars} · ${p.hasBody ? "reviewed" : "logged"} ${when}`;
}

/**
 * "Activity from people you follow" (§2.12): a row of avatars with their stars underneath, a lines
 * badge when they wrote a review and a bookmark badge when it's only in their queue.
 */
export function FollowingActivityStrip({
  activity,
  allHref,
}: {
  activity: FollowingActivity;
  allHref: string;
}) {
  if (activity.people.length === 0) return null;
  const shown = activity.people.slice(0, MAX_DESKTOP);
  const extra = activity.people.length - shown.length;

  return (
    <section aria-labelledby="activity-heading" className="space-y-3">
      <div className="flex items-baseline justify-between border-b pb-2">
        <h2 id="activity-heading" className="text-sm font-semibold tracking-wide uppercase">
          Activity from people you follow
        </h2>
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {activity.listened} listened
          {activity.inQueue > 0 ? ` · ${activity.inQueue} in queue` : ""}
        </p>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-4">
        {shown.map((p, i) => {
          const href =
            p.kind === "log" && p.reviewSlug ? `/u/${p.handle}/${p.reviewSlug}` : `/u/${p.handle}`;
          return (
            <li key={p.userId} className={cn("w-11", i >= MAX_MOBILE && "max-sm:hidden")}>
              <Link
                href={href}
                title={tooltip(p)}
                aria-label={tooltip(p)}
                className="focus-visible:ring-ring relative mx-auto block w-fit rounded-full outline-none focus-visible:ring-2"
              >
                <UserAvatar user={p} size={40} />
                {(p.hasBody || p.kind === "queue") && (
                  <span className="bg-foreground text-background absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full">
                    {p.kind === "queue" ? (
                      <Bookmark className="size-2.5" aria-hidden />
                    ) : (
                      <AlignLeft className="size-2.5" aria-hidden />
                    )}
                  </span>
                )}
              </Link>
              <div className="mt-1 flex h-3 justify-center">
                <StarRating rating={p.rating} size={9} />
              </div>
            </li>
          );
        })}
        {extra > 0 && (
          <li className="flex w-11 items-start justify-center">
            <Link
              href={allHref}
              className="bg-muted hover:bg-muted/70 flex size-10 items-center justify-center rounded-full text-xs font-medium"
            >
              +{extra}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

/** "People you follow: ★3.9 · 12 ratings" under the site average (S24). Hidden when empty. */
export function FollowingAverage({ average }: { average: FollowingActivity["average"] }) {
  if (!average) return null;
  const stars = (average.sum / average.count / 2).toFixed(1);
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">People you follow:</span>{" "}
      <span className="font-semibold tabular-nums">★{stars}</span>{" "}
      <span className="text-muted-foreground">
        · {average.count} {average.count === 1 ? "rating" : "ratings"}
      </span>
    </p>
  );
}
