import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipButton } from "@/components/clip-button";
import { CommentSection } from "@/components/social/comment-section";
import { HeartButton } from "@/components/social/heart-button";
import { ReportButton } from "@/components/social/report-button";
import { ReviewBody } from "@/components/review-body";
import { StarRating } from "@/components/star-rating";
import { buttonVariants } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { albumPath } from "@/lib/albums/paths";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { REVIEW_IMAGE_PREFIX } from "@/lib/images/process";
import { markdownExcerpt } from "@/lib/markdown/directives";
import { albumCoverUrl } from "@/lib/music";
import { VIEWER_DEFAULT_THEME_COOKIE } from "@/lib/profiles/prefs";
import { resolveProfileTheme } from "@/lib/profiles/themes";
import { getReviewPage } from "@/lib/reviews/queries";
import { ratingLabel } from "@/components/star-rating";
import { listComments } from "@/lib/social/comments";
import { getReviewHearts } from "@/lib/social/reactions";
import { storagePublicUrl } from "@/lib/storage/r2";

type Props = { params: Promise<{ handle: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params;
  const viewer = toViewer(await getCurrentUser());
  const data = await getReviewPage(handle, slug, viewer);
  if (!data) return { title: "Review not found", robots: { index: false } };
  const { review, author, album } = data;
  const name = author.displayName ?? `@${author.handle}`;
  const heading = `${album.title} by ${album.artist.name}`;
  const title = review.title ? `${review.title} (${heading})` : `${name} on ${heading}`;
  const excerpt = markdownExcerpt(review.body, 200);
  const stars = review.rating === null ? "" : `${ratingLabel(review.rating)}. `;
  const isPrivate = author.isPrivate;
  const indexable = !isPrivate && review.status === "published";
  return {
    title,
    // Private accounts: nothing but the album is shared (matches their share image).
    description: isPrivate ? heading : `${stars}${excerpt}`.trim() || heading,
    robots: indexable ? undefined : { index: false, follow: false },
    openGraph: { type: "article", title },
    twitter: { card: "summary_large_image" },
  };
}

export default async function ReviewPage({ params }: Props) {
  const { handle, slug } = await params;
  const current = await getCurrentUser();
  const data = await getReviewPage(handle, slug, toViewer(current));
  if (!data) notFound();

  const { review, author, authorProfile, album, tracks, clipTrack, tags } = data;
  const isOwner = current?.id === author.id;
  const forceDefault = (await cookies()).get(VIEWER_DEFAULT_THEME_COOKIE)?.value === "1";
  const theme = resolveProfileTheme({
    preset: authorProfile?.themePreset,
    accentColor: authorProfile?.accentColor,
    forceDefault,
  });
  const imagePrefix = storagePublicUrl(REVIEW_IMAGE_PREFIX);
  const published = review.status === "published";
  const isLog = review.body.trim() === "";
  const viewer = toViewer(current);
  const [heartMap, thread] = published
    ? await Promise.all([
        getReviewHearts([review.id], current?.id ?? null),
        listComments(review.id, author.id, viewer),
      ])
    : [new Map<string, { count: number; hearted: boolean }>(), { comments: [], total: 0 }];
  const hearts = heartMap.get(review.id) ?? { count: 0, hearted: false };
  const reviewPath = `/u/${author.handle}/${review.slug}`;

  return (
    <div
      className="profile-theme min-h-[calc(100vh-3.5rem)] pb-16"
      data-themed={theme.themed}
      style={theme.style}
    >
      <main className="mx-auto max-w-3xl px-4 py-8">
        {!published && (
          <p className="bg-muted mb-4 rounded-lg px-4 py-2 text-sm" role="status">
            This is a draft. Only you can see it.{" "}
            <Link href={`/write/${review.id}`} className="underline">
              Keep editing
            </Link>
          </p>
        )}

        <article>
          <header className="flex gap-4 sm:gap-6">
            <Link
              href={albumPath(album)}
              className="bg-muted relative block size-28 shrink-0 overflow-hidden rounded-lg shadow-sm sm:size-44"
            >
              <Image
                src={albumCoverUrl(album, 500)}
                alt={`Album cover of ${album.title} by ${album.artist.name}`}
                fill
                sizes="(min-width: 640px) 176px, 112px"
                unoptimized
                priority
                className="object-cover"
              />
            </Link>
            <div className="min-w-0 space-y-2">
              <p className="text-muted-foreground text-sm">
                <Link
                  href={albumPath(album)}
                  className="text-foreground font-semibold hover:underline"
                >
                  {album.title}
                </Link>{" "}
                · {album.artist.name}
                {album.releaseDate ? ` · ${album.releaseDate.slice(0, 4)}` : ""}
              </p>
              {review.title && (
                <h1 className="text-2xl leading-tight font-bold sm:text-3xl">{review.title}</h1>
              )}
              {!review.title && <h1 className="sr-only">Review of {album.title}</h1>}
              <div className="flex items-center gap-2">
                <StarRating rating={review.rating} size={22} />
                {review.rating === null && (
                  <span className="text-muted-foreground text-sm">
                    {isLog ? "Listened" : "No rating"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Link
                  href={`/u/${author.handle}`}
                  className="flex items-center gap-2 hover:underline"
                >
                  <UserAvatar user={author} size={28} />
                  <span className="text-sm font-medium">
                    {author.displayName ?? `@${author.handle}`}
                  </span>
                </Link>
                {review.publishedAt && (
                  <time
                    dateTime={review.publishedAt.toISOString()}
                    className="text-muted-foreground text-sm"
                  >
                    · {review.publishedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                  </time>
                )}
              </div>
              {isOwner && (
                <Link
                  href={`/write/${review.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Pencil aria-hidden /> Edit
                </Link>
              )}
            </div>
          </header>

          {clipTrack && (
            <div className="mt-6 flex items-center gap-3">
              <ClipButton
                trackId={clipTrack.id}
                previewUrl={clipTrack.previewUrl}
                label={`${clipTrack.title}`}
              />
              <span className="text-muted-foreground text-xs">30-second clip</span>
            </div>
          )}

          {!isLog && (
            <div className="mt-6 text-[1.05rem]">
              <ReviewBody
                markdown={review.body}
                tracks={tracks}
                imagePrefixes={imagePrefix ? [imagePrefix] : []}
              />
            </div>
          )}

          {tags.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Tags">
              {tags.map((tag) => (
                <li key={tag} className="bg-muted rounded-full px-3 py-1 text-sm">
                  {tag}
                </li>
              ))}
            </ul>
          )}
          {published && (
            <div className="mt-6 flex items-center gap-2">
              <HeartButton
                targetType="review"
                targetId={review.id}
                count={hearts.count}
                hearted={hearts.hearted}
                label={`review of ${album.title}`}
                signInHref={
                  current ? undefined : `/sign-in?callbackUrl=${encodeURIComponent(reviewPath)}`
                }
              />
              {!isOwner && (
                <ReportButton
                  targetType="review"
                  targetId={review.id}
                  subject={`review of ${album.title}`}
                  signInHref={
                    current ? undefined : `/sign-in?callbackUrl=${encodeURIComponent(reviewPath)}`
                  }
                />
              )}
            </div>
          )}
        </article>

        {published && (
          <CommentSection
            reviewId={review.id}
            reviewPath={reviewPath}
            viewerId={current?.id ?? null}
            comments={thread.comments}
            total={thread.total}
          />
        )}
      </main>
    </div>
  );
}
