import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { StarRating } from "@/components/star-rating";
import { UserAvatar } from "@/components/user-avatar";
import { albumPath, artistPath } from "@/lib/albums/paths";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { getList } from "@/lib/lists/service";
import { albumCoverUrl } from "@/lib/music";

type Props = { params: Promise<{ handle: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params;
  const viewer = toViewer(await getCurrentUser());
  const list = await getList(handle, slug, viewer);
  if (!list) return { title: "List not found" };
  const indexable = list.status === "published" && !list.author.isPrivate;
  const first = list.items[0];
  return {
    title: `${list.title} by ${list.author.displayName ?? `@${list.author.handle}`}`,
    description:
      list.description ??
      `A list of ${list.items.length} albums${first ? `, starting with ${first.album.title}` : ""}.`,
    robots: indexable ? undefined : { index: false, follow: false },
    openGraph: first ? { images: [{ url: albumCoverUrl(first.album, 500) }] } : undefined,
  };
}

export default async function ListPage({ params }: Props) {
  const { handle, slug } = await params;
  if (handle !== handle.toLowerCase()) permanentRedirect(`/lists/${handle.toLowerCase()}/${slug}`);
  const current = await getCurrentUser();
  const list = await getList(handle, slug, toViewer(current));
  if (!list) notFound();
  const isOwner = current?.id === list.author.id;
  const authorName = list.author.displayName ?? `@${list.author.handle}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {list.status !== "published" && (
        <p role="status" className="bg-muted mb-4 rounded-md px-3 py-2 text-sm">
          {list.status === "draft"
            ? "This is a draft. Only you can see it."
            : "A moderator took this list down. Only you and moderators can see it."}
        </p>
      )}
      <header className="space-y-2 border-b pb-5">
        <h1 className="text-3xl leading-tight font-bold">{list.title}</h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={`/u/${list.author.handle}`}
            className="text-foreground inline-flex items-center gap-2 font-medium hover:underline"
          >
            <UserAvatar user={list.author} size={24} />
            {authorName}
          </Link>
          <span aria-hidden>·</span>
          <span>
            {list.items.length} {list.items.length === 1 ? "album" : "albums"}
            {list.year ? ` · ${list.year}` : ""}
          </span>
          {isOwner && list.status !== "hidden" && (
            <>
              <span aria-hidden>·</span>
              <Link href={`/write/list/${list.id}`} className="underline underline-offset-2">
                Edit
              </Link>
            </>
          )}
        </p>
        {list.description && (
          <p className="max-w-prose text-sm whitespace-pre-wrap">{list.description}</p>
        )}
      </header>

      {list.items.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          No albums in this list yet.
        </p>
      ) : (
        <ol className="divide-y">
          {list.items.map((item) => (
            <li key={item.album.mbid} className="flex gap-4 py-4">
              <span
                className="text-muted-foreground w-8 shrink-0 pt-1 text-right text-lg font-semibold tabular-nums"
                aria-hidden={!list.ranked}
              >
                {list.ranked ? item.position : ""}
              </span>
              <Link
                href={albumPath(item.album)}
                className="bg-muted relative size-20 shrink-0 overflow-hidden rounded-md sm:size-24"
              >
                <Image
                  src={albumCoverUrl(item.album, 250)}
                  alt={`Album cover of ${item.album.title} by ${item.artist.name}`}
                  fill
                  sizes="96px"
                  unoptimized
                  className="object-cover"
                />
              </Link>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">
                  <Link href={albumPath(item.album)} className="hover:underline">
                    {item.album.title}
                  </Link>
                  {item.album.releaseDate && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      ({item.album.releaseDate.slice(0, 4)})
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground text-sm">
                  <Link href={artistPath(item.artist)} className="hover:underline">
                    {item.artist.name}
                  </Link>
                </p>
                {item.note && <p className="pt-1 text-sm whitespace-pre-wrap">{item.note}</p>}
                {item.reviewSlug && (
                  <p className="flex items-center gap-2 pt-1 text-sm">
                    <StarRating rating={item.rating} size={14} />
                    <Link
                      href={`/u/${list.author.handle}/${item.reviewSlug}`}
                      className="underline underline-offset-2"
                    >
                      {authorName}&apos;s review
                    </Link>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
