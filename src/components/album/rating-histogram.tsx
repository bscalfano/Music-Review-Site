import { cn } from "@/lib/utils";

/** Average in stars to one decimal, or null when nobody has rated yet. */
export function averageStars(ratingSum: number, ratingCount: number): string | null {
  return ratingCount === 0 ? null : (ratingSum / ratingCount / 2).toFixed(1);
}

/**
 * 11 bars, 0★ to 5★ in half-star steps, from `album_stats` (no aggregation at request time).
 * `compact` drops the labels for use on cards.
 */
export function RatingHistogram({
  histogram,
  ratingSum,
  ratingCount,
  className,
}: {
  histogram: number[];
  ratingSum: number;
  ratingCount: number;
  className?: string;
}) {
  const max = Math.max(1, ...histogram);
  const average = averageStars(ratingSum, ratingCount);
  const summary = histogram
    .map((n, i) => `${n} rating${n === 1 ? "" : "s"} of ${i === 0 ? "0" : i / 2} stars`)
    .join(", ");

  return (
    <div className={cn("flex items-end gap-3", className)}>
      <div
        role="img"
        aria-label={`Rating distribution: ${summary}`}
        className="flex h-16 flex-1 items-end gap-0.5"
      >
        {histogram.map((count, i) => (
          <div key={i} className="flex h-full flex-1 items-end" title={`${i / 2}★: ${count}`}>
            <div
              className={cn(
                "w-full rounded-t-sm",
                count > 0 ? "bg-(--profile-accent,var(--primary))/70" : "bg-muted",
              )}
              style={{ height: `${count > 0 ? Math.max(8, (count / max) * 100) : 4}%` }}
            />
          </div>
        ))}
      </div>
      <div className="text-right">
        <p className="text-3xl leading-none font-bold tabular-nums">{average ?? "–"}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {ratingCount === 0
            ? "No ratings"
            : `${ratingCount.toLocaleString("en-US")} rating${ratingCount === 1 ? "" : "s"}`}
        </p>
      </div>
    </div>
  );
}
