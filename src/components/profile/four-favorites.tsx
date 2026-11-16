import { Plus } from "lucide-react";
import Link from "next/link";
import { CoverImage } from "@/components/cover-image";
import { StarRating } from "@/components/star-rating";
import type { FavoriteAlbum } from "@/lib/profiles/queries";

/** Four Favorites: up to four albums in a fixed order. Empty slots are only shown to the owner. */
export function FourFavorites({
  handle,
  favorites,
  isOwner,
}: {
  handle: string;
  favorites: FavoriteAlbum[];
  isOwner: boolean;
}) {
  if (favorites.length === 0 && !isOwner) return null;
  const byPosition = new Map(favorites.map((f) => [f.position, f]));
  const slots = [1, 2, 3, 4].filter((p) => byPosition.has(p) || isOwner);

  return (
    <section aria-labelledby="favorites-heading" className="space-y-2">
      <div className="flex items-baseline justify-between border-b pb-1">
        <h2
          id="favorites-heading"
          className="text-muted-foreground text-xs font-semibold tracking-widest"
        >
          FAVORITE ALBUMS
        </h2>
        {isOwner && (
          <Link
            href="/settings#favorites"
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          >
            Edit
          </Link>
        )}
      </div>
      <ul className="grid grid-cols-4 gap-2 sm:gap-3">
        {slots.map((position) => {
          const fav = byPosition.get(position);
          if (!fav) {
            return (
              <li key={position}>
                <Link
                  href="/settings#favorites"
                  aria-label={`Add favorite album ${position}`}
                  className="text-muted-foreground hover:text-foreground hover:border-foreground/40 flex aspect-square items-center justify-center rounded-md border border-dashed transition-colors"
                >
                  <Plus />
                </Link>
              </li>
            );
          }
          const href = fav.reviewSlug
            ? `/u/${handle}/${fav.reviewSlug}`
            : `/albums/${fav.album.slug}-${fav.album.mbid}`;
          return (
            <li key={position}>
              <Link
                href={href}
                className="group focus-visible:ring-ring relative block aspect-square overflow-hidden rounded-md shadow-sm outline-none focus-visible:ring-3"
              >
                <CoverImage
                  album={fav.album}
                  artistName={fav.artistName}
                  sizes="(min-width: 640px) 160px, 25vw"
                />
                <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/85 to-transparent p-2 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <span className="truncate text-xs font-semibold">{fav.album.title}</span>
                  <span className="truncate text-[11px] text-white/80">{fav.artistName}</span>
                  <StarRating rating={fav.rating} size={12} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
