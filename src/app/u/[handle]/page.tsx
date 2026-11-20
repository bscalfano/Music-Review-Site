import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { FilterBar } from "@/components/filter-bar";
import { CoverGrid } from "@/components/profile/cover-grid";
import { FourFavorites } from "@/components/profile/four-favorites";
import { ProfileHeader } from "@/components/profile/profile-header";
import {
  ListsTab,
  parseTab,
  PinnedSection,
  ProfileTabs,
  QueueTab,
  StatsTab,
} from "@/components/profile/profile-tabs";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { filtersToQuery, hasActiveFilters, parseFilters } from "@/lib/discovery/filters";
import { countLists, listsForUser } from "@/lib/lists/service";
import { countQueued, listQueue, listSuggestions } from "@/lib/queue/service";
import { getPins } from "@/lib/pins/service";
import { getUserStats } from "@/lib/stats/user-stats";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
  const sp = await searchParams;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const tab = parseTab(sp.tab);
  const filters = parseFilters(sp);
  const page = Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1;
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
  const active = hasActiveFilters(filters);

  const forceDefault = (await cookies()).get(VIEWER_DEFAULT_THEME_COOKIE)?.value === "1";
  const theme = resolveProfileTheme({
    preset: profile?.themePreset,
    accentColor: profile?.accentColor,
    forceDefault,
  });

  const emptyGrid = { items: [], nextCursor: null, nextPage: null, total: 0, overall: 0 };
  const [counts, favorites, grid, listCount, queueCount, pins] = await Promise.all([
    getFollowCounts(user.id),
    canSeeContent ? getFavorites(user.id) : Promise.resolve([]),
    canSeeContent
      ? getProfileGrid({
          userId: user.id,
          viewer,
          cursor,
          filters,
          page,
          // Only the reviews tab shows the grid; the others just need the totals.
          limit: tab === "reviews" ? undefined : 1,
        })
      : Promise.resolve(emptyGrid),
    canSeeContent ? countLists(user.id, isOwner) : Promise.resolve(0),
    canSeeContent ? countQueued(user.id) : Promise.resolve(0),
    canSeeContent && tab === "reviews" && !cursor && page === 1 && !active
      ? getPins(user.id, viewer)
      : Promise.resolve([]),
  ]);
  const tabData = canSeeContent
    ? {
        lists: tab === "shelves" ? await listsForUser(user.id, isOwner) : [],
        queue: tab === "queue" ? await listQueue(user.id) : [],
        suggestions: tab === "queue" && isOwner ? await listSuggestions(user.id) : [],
        stats: tab === "stats" ? await getUserStats(user.id, viewer) : null,
      }
    : null;
  const ownerName = user.displayName ?? `@${user.handle}`;

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
        reviewCount={grid.overall}
        isOwner={isOwner}
        viewerId={current?.id ?? null}
        followState={relation.followState}
        countsVisible={canSeeContent}
      />

      <main className="mx-auto mt-8 max-w-5xl space-y-8 px-4">
        {canSeeContent ? (
          <>
            <FourFavorites handle={user.handle!} favorites={favorites} isOwner={isOwner} />

            <PinnedSection handle={user.handle!} pins={pins} />

            <section aria-label={tab === "reviews" ? "Reviews" : undefined} className="space-y-3">
              <ProfileTabs
                handle={user.handle!}
                active={tab}
                counts={{ reviews: grid.overall, shelves: listCount, queue: queueCount }}
              />

              {tab === "reviews" && (
                <>
                  {grid.overall > 1 && (
                    <FilterBar basePath={`/u/${user.handle}`} filters={filters} />
                  )}
                  {active && grid.overall > 0 && (
                    <p role="status" className="text-muted-foreground text-sm">
                      {grid.total} of {grid.overall} {grid.overall === 1 ? "review" : "reviews"}
                    </p>
                  )}

                  {grid.items.length > 0 ? (
                    <CoverGrid
                      handle={user.handle!}
                      items={grid.items}
                      showRatings={profile?.gridShowRatings ?? true}
                    />
                  ) : active && grid.overall > 0 ? (
                    <p className="text-muted-foreground py-12 text-center text-sm">
                      Nothing matches those filters.
                    </p>
                  ) : (
                    <p className="text-muted-foreground py-12 text-center text-sm">
                      {isOwner
                        ? "You haven't logged any albums yet."
                        : `${user.displayName ?? user.handle} hasn't logged any albums yet.`}
                    </p>
                  )}

                  {(grid.nextCursor || grid.nextPage) && (
                    <div className="flex justify-center pt-2">
                      <Link
                        href={`/u/${user.handle}?${filtersToQuery(
                          filters,
                          grid.nextCursor
                            ? { cursor: grid.nextCursor }
                            : { page: String(grid.nextPage) },
                        )}`}
                        className="text-sm underline underline-offset-4"
                      >
                        {grid.nextCursor ? "Older reviews →" : "More →"}
                      </Link>
                    </div>
                  )}
                </>
              )}
              {tab === "shelves" && tabData && (
                <ListsTab handle={user.handle!} lists={tabData.lists} isOwner={isOwner} />
              )}
              {tab === "queue" && tabData && (
                <QueueTab
                  ownerId={user.id}
                  ownerName={ownerName}
                  queue={tabData.queue}
                  suggestions={tabData.suggestions}
                  isOwner={isOwner}
                  acceptsSuggestions={user.acceptSuggestions}
                  canSuggest={!!current}
                  signInHref={
                    current
                      ? undefined
                      : `/sign-in?callbackUrl=${encodeURIComponent(`/u/${user.handle}?tab=queue`)}`
                  }
                />
              )}
              {tab === "stats" && tabData?.stats && (
                <StatsTab stats={tabData.stats} name={ownerName} />
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
