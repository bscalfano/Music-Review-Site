import Image from "next/image";
import { albumCoverUrl } from "@/lib/music";
import { cn } from "@/lib/utils";

/** A square album cover with descriptive alt text. Covers are already sized, so no optimizer. */
export function CoverImage({
  album,
  artistName,
  size = 500,
  className,
  sizes = "(min-width: 1024px) 16vw, (min-width: 640px) 25vw, 33vw",
}: {
  album: { mbid: string; title: string; coverKey: string | null };
  artistName: string;
  size?: 250 | 500 | 1200;
  className?: string;
  sizes?: string;
}) {
  return (
    <Image
      src={albumCoverUrl(album, size)}
      alt={`Album cover of ${album.title} by ${artistName}`}
      fill
      sizes={sizes}
      unoptimized
      className={cn("bg-muted object-cover", className)}
    />
  );
}
