import type { Metadata } from "next";
import Link from "next/link";
import { FeedCard } from "@/components/social/feed-card";
import { SuggestedReviewers } from "@/components/social/discover-extras";
import { buttonVariants } from "@/components/ui/button";
import { requireUser, toViewer } from "@/lib/auth/session";
import { countFollowing, getFollowingFeed, getSuggestedReviewers } from "@/lib/social/feed";

export const metadata: Metadata = { title: "Following", robots: { index: false } };

type Props = { searchParams: Promise<{ cursor?: string }> };

export default async function FeedPage({ searchParams }: Props) {
  const user = await requireUser({ returnTo: "/feed" });
  const { cursor } = await searchParams;
  const viewer = toViewer(user)!;

  const [{ items, nextCursor }, following] = await Promise.all([
    getFollowingFeed(viewer, cursor),
    countFollowing(user.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Following</h1>
        <Link href="/write" className={buttonVariants({ size: "sm" })}>
          Write a review
        </Link>
      </div>

      {items.length > 0 ? (
        <ul className="divide-y">
          {items.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </ul>
      ) : following === 0 ? (
        <NewUserEmptyState viewerId={user.id} />
      ) : (
        <p className="text-muted-foreground py-16 text-center text-sm">
          {cursor ? "That's everything." : "Nothing new from the people you follow yet."}{" "}
          <Link href="/discover" className="underline">
            Find more people on Discover
          </Link>
          .
        </p>
      )}

      {nextCursor && (
        <div className="pt-4 text-center">
          <Link
            href={`/feed?cursor=${encodeURIComponent(nextCursor)}`}
            className="text-sm underline underline-offset-4"
          >
            Older →
          </Link>
        </div>
      )}
    </main>
  );
}

/** You follow nobody, so the feed is empty: point at people worth following. */
async function NewUserEmptyState({ viewerId }: { viewerId: string }) {
  const people = await getSuggestedReviewers({ id: viewerId, isAdmin: false });
  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="font-medium">Your feed is empty</p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
          Follow a few reviewers and their reviews will show up here, newest first.
        </p>
      </div>
      <SuggestedReviewers people={people} viewerId={viewerId} />
      <p className="text-center text-sm">
        <Link href="/discover" className="underline underline-offset-4">
          Browse recent reviews from everyone
        </Link>
      </p>
    </div>
  );
}
