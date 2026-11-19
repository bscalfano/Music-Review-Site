import Image from "next/image";
import Link from "next/link";
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
 * the shelf is long, snapping sleeve by sleeve like flipping through a crate.
 */
export function ShelfRow({ albums }: { albums: (Cover & { artistName: string })[] }) {
  if (albums.length === 0) return null;
  return (
    <div className="space-y-0">
      <ul
        aria-label="Records on this shelf"
        className="flex snap-x snap-mandatory items-end overflow-x-auto px-2 pt-8 pb-0"
      >
        {albums.map((a) => (
          <li
            key={a.mbid}
            className="group relative -ml-10 w-36 shrink-0 snap-start transition-transform duration-200 first:ml-0 focus-within:z-10 focus-within:-translate-y-4 hover:z-10 sm:w-40"
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
      </ul>
      <Board />
    </div>
  );
}

/** Most sleeves a mini shelf shows. */
export const MINI_SHELF_MAX = 12;

/**
 * A small shelf for profile tabs and the feed. The board is always full width, and sleeves stand
 * on it inset a little so the board overhangs both ends. A short shelf keeps its sleeves together
 * at the left; a long one is spread so the first and last sleeves sit at the inset edges.
 */
export function MiniShelf({ covers }: { covers: Omit<Cover, "slug">[] }) {
  const shown = covers.slice(0, MINI_SHELF_MAX);
  const n = shown.length;
  if (n === 0) return null;
  const size = "4rem"; // one sleeve
  const step = "2.5rem"; // how far apart sleeves sit when there's room
  return (
    <div>
      <div className="relative mx-3 h-20" aria-hidden>
        {shown.map((c, i) => (
          <Bump
            key={c.mbid}
            lift="-0.4rem"
            className="bg-muted absolute bottom-0 size-16 overflow-hidden rounded-[2px] shadow-[2px_0_6px_rgb(0_0_0/0.4)]"
            style={{
              left:
                n === 1 ? 0 : `min(calc(${i} * ${step}), calc((100% - ${size}) * ${i} / ${n - 1}))`,
            }}
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
      </div>
      <Board thin />
    </div>
  );
}
