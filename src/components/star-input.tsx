"use client";

import { useState } from "react";
import { ratingLabel } from "@/components/star-rating";
import { cn } from "@/lib/utils";

const STAR =
  "M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52 6.12 20.6l1.12-6.55L2.48 9.42l6.58-.96L12 2.5z";

/**
 * Half-star picker. Each star has a left and a right half you can click (1..10 half-star
 * units). Keyboard: Left/Right arrows move by half a star, Home/End jump to the ends.
 * `value` null = no rating; 0 = zero stars. Zero and "no rating" are chosen elsewhere
 * (see the editor), because they're deliberately separate from the star row.
 */
export function StarInput({
  value,
  onChange,
  size = 28,
  allowClear = false,
  label = "Rating",
  disabled = false,
}: {
  value: number | null;
  onChange: (rating: number | null) => void;
  size?: number;
  /** Clicking the already-selected half clears the rating (quick-log behaviour). */
  allowClear?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  function pick(next: number) {
    onChange(allowClear && next === value ? null : next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    const current = value ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(10, current + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, current - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 10;
    if (next !== null) {
      e.preventDefault();
      onChange(next);
    }
  }

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={value ?? 0}
      aria-valuetext={value === null ? "No rating" : ratingLabel(value)}
      aria-disabled={disabled}
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHover(null)}
      className="focus-visible:ring-ring inline-flex rounded-md outline-none focus-visible:ring-2"
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const full = shown >= 2 * (i + 1);
        const half = shown === 2 * i + 1;
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
              <defs>
                <clipPath id={`si-half-${i}`}>
                  <rect x="0" y="0" width="12" height="24" />
                </clipPath>
              </defs>
              <path d={STAR} className="fill-muted-foreground/25" />
              {(full || half) && (
                <path
                  d={STAR}
                  className="fill-(--profile-accent,var(--primary))"
                  clipPath={half ? `url(#si-half-${i})` : undefined}
                />
              )}
            </svg>
            {[2 * i + 1, 2 * i + 2].map((units, side) => (
              <button
                key={units}
                type="button"
                tabIndex={-1}
                disabled={disabled}
                aria-label={ratingLabel(units)}
                onClick={() => pick(units)}
                onMouseEnter={() => setHover(units)}
                className={cn(
                  "absolute inset-y-0 w-1/2 cursor-pointer",
                  side === 0 ? "left-0" : "right-0",
                )}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
}
