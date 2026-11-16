import { AlignLeft } from "lucide-react";
import Link from "next/link";
import { CoverImage } from "@/components/cover-image";
import { StarRating } from "@/components/star-rating";
import type { GridItem } from "@/lib/profiles/queries";

/** Square cover tiles: 3 columns on phones, up to 6 on wide screens. */
export function CoverGrid({
  handle,
  items,
  showRatings,
}: {
  handle: string;
  items: GridItem[];
  showRatings: boolean;
}) {
  return (
    <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-1.5 lg:grid-cols-6">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/u/${handle}/${item.slug}`}
            className="group focus-visible:ring-ring relative block aspect-square overflow-hidden rounded-sm outline-none focus-visible:ring-3"
          >
            <CoverImage album={item.album} artistName={item.artistName} />
            {item.hasBody && (
              <span
                className="absolute top-1 right-1 rounded bg-black/60 p-0.5 text-white"
                title="Has a written review"
              >
                <AlignLeft className="size-3" aria-label="Has a written review" />
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/85 to-transparent p-2 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="truncate text-xs font-semibold">{item.album.title}</span>
              <span className="truncate text-[11px] text-white/80">{item.artistName}</span>
              {showRatings && <StarRating rating={item.rating} size={12} />}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
