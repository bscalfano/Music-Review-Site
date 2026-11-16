import { cn } from "@/lib/utils";

const STAR =
  "M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52 6.12 20.6l1.12-6.55L2.48 9.42l6.58-.96L12 2.5z";

/** "3.5 out of 5 stars" / "0 stars". `rating` is in half-star units: 0 to 10. */
export function ratingLabel(rating: number): string {
  return rating === 0 ? "0 stars" : `${rating / 2} out of 5 stars`;
}

/**
 * Read-only star display. `null` (no rating) renders nothing at all, which is deliberately
 * different from 0 (zero stars), which renders an explicit "0★" mark.
 */
export function StarRating({
  rating,
  size = 16,
  className,
}: {
  rating: number | null;
  size?: number;
  className?: string;
}) {
  if (rating === null) return null;
  if (rating === 0) {
    return (
      <span
        role="img"
        aria-label="0 stars"
        className={cn("text-muted-foreground leading-none font-medium", className)}
        style={{ fontSize: size }}
      >
        0★
      </span>
    );
  }
  return (
    <span role="img" aria-label={ratingLabel(rating)} className={cn("inline-flex", className)}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = rating >= 2 * (i + 1) ? 1 : rating === 2 * i + 1 ? 0.5 : 0;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <clipPath id={`half-${i}`}>
                <rect x="0" y="0" width="12" height="24" />
              </clipPath>
            </defs>
            <path d={STAR} className="fill-muted-foreground/25" />
            {fill > 0 && (
              <path
                d={STAR}
                className="fill-(--profile-accent,currentColor)"
                clipPath={fill === 0.5 ? `url(#half-${i})` : undefined}
              />
            )}
          </svg>
        );
      })}
    </span>
  );
}
