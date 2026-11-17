import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { FollowingActivityStrip, FollowingAverage } from "@/components/album/following-activity";
import { QuickLog } from "@/components/album/quick-log";
import { RatingHistogram } from "@/components/album/rating-histogram";
import { ClipButton } from "@/components/clip-button";
import { ReviewCard } from "@/components/review-card";
import { albumPath, parseAlbumSegment } from "@/lib/albums/paths";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs";
import { getFollowingActivity, type FollowingActivity } from "@/lib/social/album-activity";
import { albumCoverUrl } from "@/lib/music";
import {
  getAlbumByMbid,
  getAlbumStats,
  getAlbumTracks,
  getMyAlbumState,
  listAlbumReviews,
} from "@/lib/reviews/queries";

type Props = { params: Promise<{ slug: string }> };

const SECTION_SIZE = 5;

function formatDuration(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = parseAlbumSegment((await params).slug);
  const album = parsed && (await getAlbumByMbid(parsed.mbid));
  if (!album) return { title: "Album not found" };
  const stats = await getAlbumStats(album.id);
  const average = stats.ratingCount
    ? `${(stats.ratingSum / stats.ratingCount / 2).toFixed(1)} average from ${stats.ratingCount} ratings. `
    : "";
  return {
    title: `${album.title} by ${album.artist.name}`,
    description: `${average}Reviews of ${album.title} by ${album.artist.name}.`,
    openGraph: { images: [{ url: albumCoverUrl(album, 500) }] },
  };
}

export default async function AlbumPage({ params }: Props) {
  const segment = (await params).slug;
  const parsed = parseAlbumSegment(segment);
  if (!parsed) notFound();
  const album = await getAlbumByMbid(parsed.mbid);
  if (!album) notFound();
  // Old or hand-typed slugs still work; send them to the canonical URL.
  if (parsed.slug !== album.slug) permanentRedirect(albumPath(album));
  if (!album.enrichedAt) kickJobs();

  const current = await getCurrentUser();
  const viewer = toViewer(current);

  const [stats, tracks, mine, activity, followed] = await Promise.all([
    getAlbumStats(album.id),
    getAlbumTracks(album.id),
    current ? getMyAlbumState(current.id, album.id) : Promise.resolve(null),
    getFollowingActivity(album.id, viewer),
    viewer
      ? listAlbumReviews({
          albumId: album.id,
          viewer,
          sort: "recent",
          limit: 3,
          followingOnly: true,
        })
      : Promise.resolve({ items: [], total: 0 }),
  ]);
  // Reviews already shown under "people you follow" aren't repeated below.
  const shownIds = followed.items.map((r) => r.id);
  const popular = await listAlbumReviews({
    albumId: album.id,
    viewer,
    sort: "popular",
    limit: SECTION_SIZE,
    excludeIds: shownIds,
  });
  const recent = await listAlbumReviews({
    albumId: album.id,
    viewer,
    sort: "recent",
    limit: SECTION_SIZE,
    excludeIds: [...shownIds, ...popular.items.map((r) => r.id)],
  });

  const year = album.releaseDate?.slice(0, 4);
  const reviewsHref = `${albumPath(album)}/reviews`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-28 lg:pb-8">
      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)_19rem]">
        {/* Left: cover */}
        <div className="flex gap-4 lg:block">
          <div className="bg-muted relative aspect-square w-32 shrink-0 overflow-hidden rounded-lg shadow-sm sm:w-44 lg:w-full">
            <Image
              src={albumCoverUrl(album, 500)}
              alt={`Album cover of ${album.title} by ${album.artist.name}`}
              fill
              sizes="(min-width: 1024px) 224px, 176px"
              unoptimized
              priority
              className="object-cover"
            />
          </div>
          {/* On phones the title sits beside the cover. */}
          <div className="min-w-0 lg:hidden">
            <AlbumTitle album={album} year={year} />
          </div>
        </div>

        {/* Middle: info and reviews */}
        <div className="min-w-0 space-y-8 lg:order-none">
          <div className="hidden lg:block">
            <AlbumTitle album={album} year={year} />
          </div>

          {/* Right column on desktop, directly under the title on phones */}
          <aside className="space-y-6 lg:hidden" aria-label="Ratings">
            <RatingsBlock stats={stats} following={activity.average} />
          </aside>

          {viewer && (
            <FollowingActivityStrip
              activity={activity}
              allHref={`${albumPath(album)}/reviews?filter=following`}
            />
          )}

          {followed.items.length > 0 && (
            <section aria-labelledby="following-reviews-heading">
              <h2
                id="following-reviews-heading"
                className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
              >
                Reviews from people you follow
              </h2>
              <div className="divide-y">
                {followed.items.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
              {followed.total > followed.items.length && (
                <Link
                  href={`${albumPath(album)}/reviews?filter=following`}
                  className="mt-2 inline-block text-sm underline underline-offset-4"
                >
                  All {followed.total} reviews from people you follow →
                </Link>
              )}
            </section>
          )}

          <section aria-labelledby="popular-heading">
            <h2
              id="popular-heading"
              className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
            >
              Popular reviews
            </h2>
            {popular.items.length > 0 ? (
              <div className="divide-y">
                {popular.items.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-6 text-sm">
                No written reviews yet.{" "}
                {current ? (
                  <Link href={`/write?album=${album.mbid}`} className="underline">
                    Be the first to write one.
                  </Link>
                ) : (
                  <Link href="/sign-in" className="underline">
                    Sign in to write one.
                  </Link>
                )}
              </p>
            )}
          </section>

          {recent.items.length > 0 && (
            <section aria-labelledby="recent-heading">
              <h2
                id="recent-heading"
                className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
              >
                Recent reviews
              </h2>
              <div className="divide-y">
                {recent.items.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            </section>
          )}

          {popular.total > popular.items.length + recent.items.length && (
            <Link
              href={`${reviewsHref}?sort=recent`}
              className="inline-block text-sm underline underline-offset-4"
            >
              All {popular.total} reviews →
            </Link>
          )}

          {!current && (
            <p className="text-muted-foreground text-sm">
              <Link href="/sign-in" className="underline">
                Sign in
              </Link>{" "}
              to see what people you follow think.
            </p>
          )}

          <section aria-labelledby="tracks-heading">
            <h2
              id="tracks-heading"
              className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
            >
              Tracklist
            </h2>
            {tracks.length > 0 ? (
              <ol className="divide-y">
                {tracks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="text-muted-foreground w-6 text-right tabular-nums">
                      {t.position}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatDuration(t.durationMs)}
                    </span>
                    <ClipButton
                      trackId={t.id}
                      previewUrl={t.previewUrl}
                      label={t.title}
                      variant="icon"
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground py-4 text-sm">
                {album.enrichedAt
                  ? "No track list available."
                  : "The track list is loading. Reload in a moment."}
              </p>
            )}
          </section>

          <section aria-labelledby="details-heading">
            <h2
              id="details-heading"
              className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
            >
              Details
            </h2>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 py-3 text-sm">
              <dt className="text-muted-foreground">Artist</dt>
              <dd>{album.artist.name}</dd>
              {album.primaryType && (
                <>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>{album.primaryType}</dd>
                </>
              )}
              {album.releaseDate && (
                <>
                  <dt className="text-muted-foreground">Released</dt>
                  <dd>{album.releaseDate}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                <a
                  href={`https://musicbrainz.org/release-group/${album.mbid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  MusicBrainz
                </a>
              </dd>
            </dl>
          </section>
        </div>

        {/* Right: your panel and ratings (desktop) */}
        <aside
          className="hidden space-y-6 self-start lg:sticky lg:top-20 lg:block"
          aria-label="Your rating and community ratings"
        >
          <section className="space-y-3 rounded-xl border p-4" aria-label="Your panel">
            {current ? (
              <QuickLog albumId={album.id} albumMbid={album.mbid} mine={mine} />
            ) : (
              <p className="text-sm">
                <Link
                  href={`/sign-in?callbackUrl=${encodeURIComponent(albumPath(album))}`}
                  className="underline"
                >
                  Sign in
                </Link>{" "}
                to rate and review.
              </p>
            )}
          </section>
          <RatingsBlock stats={stats} following={activity.average} />
        </aside>
      </div>

      {/* Phones: your panel becomes a bar fixed to the bottom of the screen. */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 backdrop-blur lg:hidden">
        {current ? (
          <QuickLog albumId={album.id} albumMbid={album.mbid} mine={mine} compact />
        ) : (
          <Link
            href={`/sign-in?callbackUrl=${encodeURIComponent(albumPath(album))}`}
            className="text-sm underline"
          >
            Sign in to rate and review
          </Link>
        )}
      </div>
    </main>
  );
}

function AlbumTitle({
  album,
  year,
}: {
  album: NonNullable<Awaited<ReturnType<typeof getAlbumByMbid>>>;
  year: string | undefined;
}) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl leading-tight font-bold sm:text-3xl">{album.title}</h1>
      <p className="text-muted-foreground">
        {album.artist.name}
        {year ? ` · ${year}` : ""}
      </p>
      {album.genres.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Genres">
          {album.genres.slice(0, 8).map((g) => (
            <li key={g} className="bg-muted rounded-full px-2.5 py-0.5 text-xs">
              {g}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RatingsBlock({
  stats,
  following,
}: {
  stats: Awaited<ReturnType<typeof getAlbumStats>>;
  following: FollowingActivity["average"];
}) {
  return (
    <section className="space-y-3" aria-label="Ratings">
      <div className="flex items-baseline justify-between border-b pb-2">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Ratings</h2>
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {stats.fanCount.toLocaleString("en-US")} {stats.fanCount === 1 ? "fan" : "fans"}
        </span>
      </div>
      <RatingHistogram
        histogram={stats.histogram}
        ratingSum={stats.ratingSum}
        ratingCount={stats.ratingCount}
      />
      <FollowingAverage average={following} />
    </section>
  );
}
