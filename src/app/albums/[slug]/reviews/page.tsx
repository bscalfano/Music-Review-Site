import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewCard } from "@/components/review-card";
import { albumPath, parseAlbumSegment } from "@/lib/albums/paths";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { getAlbumByMbid, listAlbumReviews, type ReviewSort } from "@/lib/reviews/queries";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; page?: string; filter?: string }>;
};

const PAGE_SIZE = 20;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = parseAlbumSegment((await params).slug);
  const album = parsed && (await getAlbumByMbid(parsed.mbid));
  return { title: album ? `Reviews of ${album.title}` : "Album not found" };
}

export default async function AlbumReviewsPage({ params, searchParams }: Props) {
  const parsed = parseAlbumSegment((await params).slug);
  const album = parsed && (await getAlbumByMbid(parsed.mbid));
  if (!album) notFound();

  const { sort: sortParam, page: pageParam, filter } = await searchParams;
  const sort: ReviewSort = sortParam === "popular" ? "popular" : "recent";
  const page = Math.max(1, Math.min(500, Number.parseInt(pageParam ?? "1", 10) || 1));
  const viewer = toViewer(await getCurrentUser());
  const followingOnly = filter === "following" && viewer !== null;
  const query = followingOnly ? "&filter=following" : "";

  const { items, total } = await listAlbumReviews({
    albumId: album.id,
    viewer,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    followingOnly,
  });
  const base = `${albumPath(album)}/reviews`;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-muted-foreground text-sm">
        <Link href={albumPath(album)} className="hover:underline">
          ← {album.title}
        </Link>
      </p>
      <h1 className="mt-1 text-2xl font-bold">
        {followingOnly ? "Reviews from people you follow" : `Reviews of ${album.title}`}
      </h1>
      {viewer && (
        <p className="mt-2 text-sm">
          <Link
            href={`${base}?sort=${sort}${followingOnly ? "" : "&filter=following"}`}
            className="text-muted-foreground underline underline-offset-4"
          >
            {followingOnly ? "Show everyone" : "Only people I follow"}
          </Link>
        </p>
      )}

      <nav aria-label="Sort reviews" className="mt-4 flex gap-4 border-b text-sm">
        {(["recent", "popular"] as const).map((s) => (
          <Link
            key={s}
            href={`${base}?sort=${s}${query}`}
            aria-current={sort === s ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 pb-2 capitalize",
              sort === s
                ? "border-foreground font-semibold"
                : "text-muted-foreground border-transparent",
            )}
          >
            {s}
          </Link>
        ))}
      </nav>

      {items.length > 0 ? (
        <div className="divide-y">
          {items.map((r) => (
            <ReviewCard key={r.id} review={r} excerptLength={600} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground py-12 text-center text-sm">No written reviews yet.</p>
      )}

      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between pt-4 text-sm">
          {page > 1 ? (
            <Link
              href={`${base}?sort=${sort}${query}&page=${page - 1}`}
              className="underline underline-offset-4"
            >
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {lastPage}
          </span>
          {page < lastPage ? (
            <Link
              href={`${base}?sort=${sort}${query}&page=${page + 1}`}
              className="underline underline-offset-4"
            >
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
