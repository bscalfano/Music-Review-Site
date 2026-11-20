import Image from "next/image";
import Link from "next/link";
import { EdgeScroller } from "@/components/lists/edge-scroller";
import { Bump } from "@/components/lists/bump";
import { albumPath } from "@/lib/albums/paths";
import { albumCoverUrl } from "@/lib/music";

type Cover = { mbid: string; slug: string; title: string; coverKey: string | null };

/** The wooden board the records stand on. */
function Board({ thin }: { thin?: boolean }) {
  return (
    <div
      aria-hidden
      className={`rounded-sm bg-linear-to-b from-amber-700 to-amber-950 shadow-[0_6px_10px_-4px_rgb(0_0_0/0.45)] ${thin ? "h-1.5" : "h-3"}`}
    />
  );
}

/**
 * A shelf of records seen from the front. Sleeves overlap like a row in a record shop; hover or
 * focus one and it slides up out of the row so you can see the whole cover. Scrolls sideways when
 * the shelf is long: wheel and touch work, and resting the mouse near either end scrolls that way.
 */
export function ShelfRow({ albums }: { albums: (Cover & { artistName: string })[] }) {
  if (albums.length === 0) return null;
  return (
    <div className="space-y-0">
      <EdgeScroller
        label="Records on this shelf"
        edge={0.17}
        className="flex items-end overflow-x-auto px-2 pt-8 pb-0"
      >
        {albums.map((a) => (
          <li
            key={a.mbid}
            className="group relative -ml-10 w-36 shrink-0 transition-transform duration-200 first:ml-0 focus-within:z-10 focus-within:-translate-y-4 hover:z-10 sm:w-40"
          >
            <Bump lift="-1rem">
              <Link
                href={albumPath(a)}
                aria-label={`${a.title} by ${a.artistName}`}
                title={`${a.title}, ${a.artistName}`}
                className="bg-muted relative block aspect-square overflow-hidden rounded-[3px] shadow-[2px_0_8px_rgb(0_0_0/0.4)] ring-offset-2 outline-none focus-visible:ring-2"
              >
                <Image
                  src={albumCoverUrl(a, 500)}
                  alt=""
                  fill
                  sizes="160px"
                  unoptimized
                  className="object-cover"
                />
              </Link>
            </Bump>
          </li>
        ))}
      </EdgeScroller>
      <Board />
    </div>
  );
}

/** Most sleeves a mini shelf loads. */
export const MINI_SHELF_MAX = 40;

/**
 * A small shelf for profile tabs and the feed. The board is always the same width, and the
 * sleeves stand on it inset a little so the board overhangs both ends. Sleeves overlap like the
 * big shelf; when they run past the board the row scrolls, and resting the mouse near either end
 * scrolls it that way.
 */
export function MiniShelf({ covers }: { covers: Omit<Cover, "slug">[] }) {
  const shown = covers.slice(0, MINI_SHELF_MAX);
  if (shown.length === 0) return null;
  return (
    <div>
      <EdgeScroller
        as="div"
        className="mx-3 flex h-20 [scrollbar-width:none] items-end overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden"
      >
        {shown.map((c) => (
          <Bump
            key={c.mbid}
            lift="-0.4rem"
            className="bg-muted relative -ml-6 size-16 shrink-0 overflow-hidden rounded-[2px] shadow-[2px_0_6px_rgb(0_0_0/0.4)] first:ml-0"
          >
            <Image
              src={albumCoverUrl(c, 250)}
              alt=""
              fill
              sizes="64px"
              unoptimized
              className="object-cover"
            />
          </Bump>
        ))}
      </EdgeScroller>
      <Board thin />
    </div>
  );
}
