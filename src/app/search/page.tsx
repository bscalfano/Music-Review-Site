import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { FeedCard } from "@/components/social/feed-card";
import { SearchBox } from "@/components/search-box";
import { UserAvatar } from "@/components/user-avatar";
import { albumPath, artistPath } from "@/lib/albums/paths";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { albumCoverUrl } from "@/lib/music";
import { cleanQuery, searchSite } from "@/lib/search/search";

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export const metadata: Metadata = {
  title: "Search",
  // Search results aren't worth indexing.
  robots: { index: false, follow: true },
};

function Group({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="border-b pb-2 text-sm font-semibold tracking-wide uppercase">
        {title} <span className="text-muted-foreground font-normal">{count}</span>
      </h2>
      {children}
    </section>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const raw = (await searchParams).q;
  const q = cleanQuery(Array.isArray(raw) ? raw[0] : raw);
  const viewer = toViewer(await getCurrentUser());
  const results = q ? await searchSite(q, viewer) : null;
  const total = results
    ? results.albums.length +
      results.artists.length +
      results.people.length +
      results.reviews.length
    : 0;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <h1 className="sr-only">Search</h1>
      <SearchBox defaultValue={q} autoFocus />

      {!results && (
        <p className="text-muted-foreground text-sm">
          Search albums, artists, people and review text. Use quotes for an exact phrase.
        </p>
      )}
      {results && total === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Nothing found for &ldquo;{results.query}&rdquo;. Albums we haven&apos;t seen yet can be
          found from the album picker when you{" "}
          <Link href="/write" className="underline">
            write a review
          </Link>
          .
        </p>
      )}

      {results && (
        <>
          <Group id="albums-h" title="Albums" count={results.albums.length}>
            <ul className="divide-y">
              {results.albums.map((a) => (
                <li key={a.mbid}>
                  <Link
                    href={albumPath({ slug: a.slug ?? "album", mbid: a.mbid })}
                    className="hover:bg-muted/50 flex items-center gap-3 py-2"
                  >
                    <Image
                      src={albumCoverUrl({ mbid: a.mbid, coverKey: a.coverKey ?? null }, 250)}
                      alt=""
                      width={48}
                      height={48}
                      unoptimized
                      className="bg-muted size-12 rounded object-cover"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.title}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {a.artist.name}
                        {a.releaseDate ? ` · ${a.releaseDate.slice(0, 4)}` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Group>

          <Group id="artists-h" title="Artists" count={results.artists.length}>
            <ul className="divide-y">
              {results.artists.map((a) => (
                <li key={a.id}>
                  <Link
                    href={artistPath(a)}
                    className="hover:bg-muted/50 flex items-baseline justify-between gap-3 py-2 text-sm"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {a.albumCount} {a.albumCount === 1 ? "album" : "albums"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Group>

          <Group id="people-h" title="People" count={results.people.length}>
            <ul className="divide-y">
              {results.people.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/u/${p.handle}`}
                    className="hover:bg-muted/50 flex items-center gap-3 py-2"
                  >
                    <UserAvatar user={p} size={40} />
                    <span className="min-w-0 text-sm">
                      <span className="block truncate font-medium">
                        {p.displayName ?? p.handle}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        @{p.handle}
                        {p.isPrivate ? " · private" : ""}
                        {p.blocked ? " · blocked" : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Group>

          <Group id="reviews-h" title="Reviews" count={results.reviews.length}>
            <ul className="divide-y">
              {results.reviews.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </ul>
          </Group>
        </>
      )}
    </main>
  );
}
