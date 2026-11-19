import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { FeedCard } from "@/components/social/feed-card";
import { SuggestedReviewers, TrendingAlbums } from "@/components/social/discover-extras";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { filtersToQuery, hasActiveFilters, parseFilters } from "@/lib/discovery/filters";
import { getDiscoverFeed, getSuggestedReviewers, getTrendingAlbums } from "@/lib/social/feed";

export const metadata: Metadata = {
  title: "Discover",
  description: "Recent album reviews from everyone.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DiscoverPage({ searchParams }: Props) {
  const sp = await searchParams;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const filters = parseFilters(sp);
  const page = Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1;
  const active = hasActiveFilters(filters);
  const paged = !!cursor || page > 1 || active;
  const current = await getCurrentUser();
  const viewer = toViewer(current);

  const [{ items, nextCursor, nextPage }, trending, people] = await Promise.all([
    getDiscoverFeed(viewer, cursor, { filters, page }),
    paged ? Promise.resolve([]) : getTrendingAlbums(),
    paged ? Promise.resolve([]) : getSuggestedReviewers(viewer),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {!current && !paged && (
        <section className="mb-8 space-y-3 rounded-2xl border p-6 sm:p-8">
          <h1 className="text-3xl font-bold tracking-tight">{siteConfig.name}</h1>
          <p className="text-muted-foreground max-w-xl">{siteConfig.tagline}</p>
          <Link href="/sign-in" className={buttonVariants()}>
            Sign in or create an account
          </Link>
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="recent-heading">
          {current || paged ? (
            <h1
              id="recent-heading"
              className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
            >
              Recent reviews
            </h1>
          ) : (
            <h2
              id="recent-heading"
              className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
            >
              Recent reviews
            </h2>
          )}
          <div className="my-3">
            <FilterBar basePath="/discover" filters={filters} />
          </div>
          {items.length > 0 ? (
            <ul className="divide-y">
              {items.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground py-16 text-center text-sm">
              {active ? (
                "Nothing matches those filters."
              ) : (
                <>
                  No reviews here yet.{" "}
                  <Link href="/write" className="underline">
                    Write the first one.
                  </Link>
                </>
              )}
            </p>
          )}
          {(nextCursor || nextPage) && (
            <div className="pt-4 text-center">
              <Link
                href={`/discover?${filtersToQuery(
                  filters,
                  nextCursor ? { cursor: nextCursor } : { page: String(nextPage) },
                )}`}
                className="text-sm underline underline-offset-4"
              >
                {nextCursor ? "Older →" : "More →"}
              </Link>
            </div>
          )}
        </section>

        <aside className="space-y-8">
          <TrendingAlbums albums={trending} />
          <SuggestedReviewers people={people} viewerId={current?.id ?? null} />
        </aside>
      </div>
    </main>
  );
}
