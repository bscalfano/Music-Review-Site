import Link from "next/link";
import { CoverImage } from "@/components/cover-image";
import { FollowButton } from "@/components/social/follow-button";
import { UserAvatar } from "@/components/user-avatar";
import { albumPath } from "@/lib/albums/paths";
import type { SuggestedReviewer, TrendingAlbum } from "@/lib/social/feed";

export function SuggestedReviewers({
  people,
  viewerId,
}: {
  people: SuggestedReviewer[];
  viewerId: string | null;
}) {
  if (people.length === 0) return null;
  return (
    <section aria-labelledby="suggested-heading">
      <h2
        id="suggested-heading"
        className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
      >
        Reviewers to follow
      </h2>
      <ul className="divide-y">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-3">
            <Link
              href={`/u/${p.handle}`}
              className="shrink-0"
              aria-label={`${p.displayName ?? p.handle}'s profile`}
            >
              <UserAvatar user={p} size={40} />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={`/u/${p.handle}`}
                className="block truncate text-sm font-semibold hover:underline"
              >
                {p.displayName ?? p.handle}
              </Link>
              <p className="text-muted-foreground truncate text-xs">
                {p.reviews} {p.reviews === 1 ? "review" : "reviews"} · {p.followers}{" "}
                {p.followers === 1 ? "follower" : "followers"}
              </p>
            </div>
            {viewerId ? <FollowButton targetId={p.id} initial={null} isPrivate={false} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TrendingAlbums({ albums }: { albums: TrendingAlbum[] }) {
  if (albums.length === 0) return null;
  return (
    <section aria-labelledby="trending-heading">
      <h2
        id="trending-heading"
        className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
      >
        Most logged this week
      </h2>
      <ul className="mt-3 grid grid-cols-4 gap-2">
        {albums.map((a) => (
          <li key={a.mbid}>
            <Link
              href={albumPath(a)}
              title={`${a.title} · ${a.artistName} (${a.logs} ${a.logs === 1 ? "log" : "logs"})`}
              className="focus-visible:ring-ring relative block aspect-square overflow-hidden rounded-md outline-none focus-visible:ring-2"
            >
              <CoverImage album={a} artistName={a.artistName} sizes="120px" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
