import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { CoverGrid } from "@/components/profile/cover-grid";
import { FourFavorites } from "@/components/profile/four-favorites";
import { ProfileHeader } from "@/components/profile/profile-header";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { VIEWER_DEFAULT_THEME_COOKIE } from "@/lib/profiles/prefs";
import {
  getFavorites,
  getFollowCounts,
  getProfileByHandle,
  getProfileGrid,
} from "@/lib/profiles/queries";
import { resolveProfileTheme } from "@/lib/profiles/themes";
import {
  authorFacts,
  canViewContent,
  canViewProfileHeader,
  loadRelation,
} from "@/lib/social/visibility";

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ cursor?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const data = await getProfileByHandle(handle);
  if (!data) return { title: "Profile not found" };
  const { user } = data;
  const name = user.displayName ?? user.handle ?? handle;
  return {
    title: `${name} (@${user.handle})`,
    description: user.isPrivate ? undefined : (user.bio ?? undefined),
    // Private accounts shouldn't be indexed or previewed.
    robots: user.isPrivate ? { index: false, follow: false } : undefined,
    // Private accounts have no feed.
    alternates: user.isPrivate
      ? undefined
      : { types: { "application/rss+xml": `/u/${user.handle}/rss.xml` } },
  };
}

export default async function ProfilePage({ params, searchParams }: Props) {
  const { handle } = await params;
  const { cursor } = await searchParams;
  if (handle !== handle.toLowerCase()) permanentRedirect(`/u/${handle.toLowerCase()}`);

  const [data, current] = await Promise.all([getProfileByHandle(handle), getCurrentUser()]);
  if (!data) notFound();
  const { user, profile } = data;

  const viewer = toViewer(current);
  const facts = authorFacts(user);
  const relation = await loadRelation(viewer, user.id);
  // A blocked, suspended or deleted profile looks exactly like one that doesn't exist.
  if (!canViewProfileHeader(viewer, facts, relation)) notFound();
  const canSeeContent = canViewContent(viewer, facts, relation);
  const isOwner = current?.id === user.id;

  const forceDefault = (await cookies()).get(VIEWER_DEFAULT_THEME_COOKIE)?.value === "1";
  const theme = resolveProfileTheme({
    preset: profile?.themePreset,
    accentColor: profile?.accentColor,
    forceDefault,
  });

  const [counts, favorites, grid] = await Promise.all([
    getFollowCounts(user.id),
    canSeeContent ? getFavorites(user.id) : Promise.resolve([]),
    canSeeContent
      ? getProfileGrid({ userId: user.id, viewer, cursor })
      : Promise.resolve({ items: [], nextCursor: null, total: 0 }),
  ]);

  return (
    <div
      className="profile-theme min-h-[calc(100vh-3.5rem)] pb-16"
      data-themed={theme.themed}
      style={theme.style}
    >
      <ProfileHeader
        user={user}
        profile={profile}
        counts={counts}
        reviewCount={grid.total}
        isOwner={isOwner}
        viewerId={current?.id ?? null}
        followState={relation.followState}
        countsVisible={canSeeContent}
      />

      <main className="mx-auto mt-8 max-w-5xl space-y-8 px-4">
        {canSeeContent ? (
          <>
            <FourFavorites handle={user.handle!} favorites={favorites} isOwner={isOwner} />

            <section aria-labelledby="reviews-heading" className="space-y-3">
              <nav aria-label="Profile sections" className="flex gap-6 border-b">
                <span
                  id="reviews-heading"
                  aria-current="page"
                  className="-mb-px border-b-2 border-(--profile-accent) pb-2 text-sm font-semibold"
                >
                  Reviews <span className="text-muted-foreground font-normal">{grid.total}</span>
                </span>
              </nav>

              {grid.items.length > 0 ? (
                <CoverGrid
                  handle={user.handle!}
                  items={grid.items}
                  showRatings={profile?.gridShowRatings ?? true}
                />
              ) : (
                <p className="text-muted-foreground py-12 text-center text-sm">
                  {isOwner
                    ? "You haven't logged any albums yet."
                    : `${user.displayName ?? user.handle} hasn't logged any albums yet.`}
                </p>
              )}

              {grid.nextCursor && (
                <div className="flex justify-center pt-2">
                  <Link
                    href={`/u/${user.handle}?cursor=${encodeURIComponent(grid.nextCursor)}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Older reviews →
                  </Link>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
            <Lock className="text-muted-foreground size-6" aria-hidden="true" />
            <p className="font-medium">This account is private</p>
            <p className="text-muted-foreground max-w-xs text-sm">
              Only people they&apos;ve approved can see their reviews and favorites.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
