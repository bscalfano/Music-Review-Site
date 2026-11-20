import { CoverImage } from "@/components/cover-image";
import { MiniShelf } from "@/components/lists/shelf-row";
import { StarRating } from "@/components/star-rating";
import { MAX_PINNED_REVIEWS, MAX_PINNED_SHELVES, type PinnedEntry } from "@/lib/pins/service";
import { PinnedEditor, type PinnedItem } from "./pinned-editor";

/** The reviews and shelves the owner pinned. Cards are drawn here; the editor makes them draggable. */
export function PinnedSection({
  handle,
  pins,
  isOwner,
}: {
  handle: string;
  pins: PinnedEntry[];
  isOwner: boolean;
}) {
  const reviews: PinnedItem[] = [];
  const shelves: PinnedItem[] = [];
  for (const p of pins) {
    if (p.kind === "review") {
      const r = p.review;
      reviews.push({
        id: r.id,
        href: `/u/${handle}/${r.slug}`,
        label: r.album.title,
        body: (
          <>
            <span className="bg-muted relative block aspect-square overflow-hidden rounded-md">
              <CoverImage album={r.album} artistName={r.artistName} />
            </span>
            <span className="block space-y-0.5 text-sm">
              <span className="line-clamp-1 block font-medium">{r.album.title}</span>
              <span className="text-muted-foreground line-clamp-1 block text-xs">
                {r.artistName}
              </span>
              <StarRating rating={r.rating} size={13} />
              {r.excerpt && (
                <span className="text-muted-foreground line-clamp-2 block text-xs">
                  {r.excerpt}
                </span>
              )}
            </span>
          </>
        ),
      });
    } else {
      const s = p.shelf;
      shelves.push({
        id: s.id,
        href: `/shelves/${handle}/${s.slug}`,
        label: s.title,
        body: (
          <>
            <MiniShelf covers={s.covers} />
            <span className="block text-sm">
              <span className="line-clamp-1 block font-medium">{s.title}</span>
              <span className="text-muted-foreground block text-xs">
                Shelf · {s.itemCount} {s.itemCount === 1 ? "album" : "albums"}
              </span>
            </span>
          </>
        ),
      });
    }
  }
  return (
    <PinnedEditor
      reviews={reviews}
      shelves={shelves}
      isOwner={isOwner}
      maxReviews={MAX_PINNED_REVIEWS}
      maxShelves={MAX_PINNED_SHELVES}
    />
  );
}
