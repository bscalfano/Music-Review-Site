import { CoverImage } from "@/components/cover-image";
import { StarRating } from "@/components/star-rating";
import type { FavoriteAlbum } from "@/lib/profiles/queries";
import { FavoritesInline, type FavoriteCard } from "./favorites-inline";

/**
 * Four Favorites: up to four albums in a fixed order. The cards are drawn here; the owner's
 * "Edit favorites" mode (reorder, remove, add) lives in the client component.
 */
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
  const cards: FavoriteCard[] = [...favorites]
    .sort((a, b) => a.position - b.position)
    .map((fav) => ({
      mbid: fav.album.mbid,
      label: fav.album.title,
      href: fav.reviewSlug
        ? `/u/${handle}/${fav.reviewSlug}`
        : `/albums/${fav.album.slug}-${fav.album.mbid}`,
      body: (
        <>
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
        </>
      ),
    }));
  return <FavoritesInline cards={cards} isOwner={isOwner} />;
}
