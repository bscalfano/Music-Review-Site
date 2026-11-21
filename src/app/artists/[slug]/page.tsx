import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoverImage } from "@/components/cover-image";
import { FeedCard } from "@/components/social/feed-card";
import { albumPath } from "@/lib/albums/paths";
import { RELEASE_CATEGORIES, releaseCategory } from "@/lib/albums/release-types";
import {
  getArtistBySlug,
  getLibraryAlbums,
  mergeDiscography,
  type ArtistAlbum,
} from "@/lib/artists/queries";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { getMusic, type AlbumSearchResult } from "@/lib/music";
import { getArtistReviews } from "@/lib/social/feed";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const artist = await getArtistBySlug((await params).slug);
  if (!artist) return { title: "Artist not found" };
  return {
    title: artist.name,
    description: `Albums and reviews of ${artist.name}.`,
  };
}

function ReleaseCard({ album: a, artistName }: { album: ArtistAlbum; artistName: string }) {
  const href = a.inLibrary
    ? albumPath({ slug: a.slug ?? "album", mbid: a.mbid })
    : `/write?album=${a.mbid}`;
  return (
    <li className="space-y-1.5">
      <Link
        href={href}
        className="focus-visible:ring-ring bg-muted relative block aspect-square overflow-hidden rounded-md outline-none focus-visible:ring-3"
      >
        <CoverImage
          album={a}
          artistName={artistName}
          sizes="(min-width: 1024px) 18vw, (min-width: 640px) 30vw, 45vw"
        />
      </Link>
      <div className="text-sm">
        <Link href={href} className="line-clamp-2 font-medium hover:underline">
          {a.title}
        </Link>
        <p className="text-muted-foreground text-xs">{a.releaseDate?.slice(0, 4) ?? "—"}</p>
        <p className="text-xs">
          {a.average ? (
            <>
              <span aria-hidden>★</span> {a.average}
              <span className="text-muted-foreground">
                {" "}
                ({a.ratingCount} {a.ratingCount === 1 ? "rating" : "ratings"})
              </span>
            </>
          ) : a.inLibrary ? (
            <span className="text-muted-foreground">No ratings yet</span>
          ) : (
            <span className="text-muted-foreground">Not reviewed yet</span>
          )}
        </p>
      </div>
    </li>
  );
}

/** MusicBrainz is slow and rate limited, so a page never waits on it for long. */
async function fetchDiscography(mbid: string): Promise<AlbumSearchResult[]> {
  try {
    return await Promise.race([
      getMusic()
        .catalog.getDiscography(mbid)
        .then((page) => page.items),
      new Promise<AlbumSearchResult[]>((resolve) => setTimeout(() => resolve([]), 6_000)),
    ]);
  } catch (err) {
    console.error("[artist] discography failed", err);
    return [];
  }
}

export default async function ArtistPage({ params }: Props) {
  const artist = await getArtistBySlug((await params).slug);
  if (!artist) notFound();
  const viewer = toViewer(await getCurrentUser());

  // Once the whole discography has been imported, our own library has all of it. Until then
  // (nobody has reviewed this artist yet) show the first page straight from MusicBrainz.
  const [library, discography, reviews] = await Promise.all([
    getLibraryAlbums(artist.id),
    artist.discographyImportedAt ? Promise.resolve([]) : fetchDiscography(artist.mbid),
    getArtistReviews(viewer, artist.id),
  ]);
  const albums = mergeDiscography(library, discography);
  const groups = RELEASE_CATEGORIES.map(
    (category) =>
      [
        category,
        albums.filter((a) => releaseCategory(a.primaryType, a.secondaryTypes) === category),
      ] as const,
  ).filter(([, items]) => items.length > 0);

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">{artist.name}</h1>
        <p className="text-muted-foreground text-sm">
          {albums.length} {albums.length === 1 ? "release" : "releases"} ·{" "}
          <a
            href={`https://musicbrainz.org/artist/${artist.mbid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            MusicBrainz
          </a>
        </p>
      </header>

      <section aria-labelledby="discography-heading" className="space-y-8">
        <h2
          id="discography-heading"
          className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
        >
          Discography
        </h2>
        {albums.length === 0 ? (
          <p className="text-muted-foreground text-sm">No releases found yet.</p>
        ) : (
          groups.map(([category, items]) => (
            <div key={category} className="space-y-3">
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {category} <span className="font-normal">{items.length}</span>
              </h3>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {items.map((a) => (
                  <ReleaseCard key={a.mbid} album={a} artistName={artist.name} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="artist-reviews-heading" className="space-y-2">
        <h2
          id="artist-reviews-heading"
          className="border-b pb-2 text-sm font-semibold tracking-wide uppercase"
        >
          Recent reviews
        </h2>
        {reviews.length > 0 ? (
          <ul className="divide-y">
            {reviews.map((item) => (
              <FeedCard key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground py-6 text-sm">
            No written reviews of {artist.name} yet.
          </p>
        )}
      </section>
    </main>
  );
}
