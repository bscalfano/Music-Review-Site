"use client";

import { useEffect, useRef } from "react";

/** Fraction of the width, at each end, where hovering starts scrolling. */
const EDGE = 0.1;
/** Fastest scroll speed, in pixels per frame, right at the edge. */
const MAX_SPEED = 14;

/**
 * A horizontally scrolling list that scrolls on its own while the mouse rests near the left or
 * right edge: the closer to the edge, the faster. Normal scrolling (wheel, touch, keyboard)
 * still works.
 */
export function EdgeScroller({
  label,
  as: Tag = "ul",
  className,
  children,
}: {
  label?: string;
  /** "ul" when the children are list items; "div" for decorative rows. */
  as?: "ul" | "div";
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const velocity = useRef(0);
  const frame = useRef<number | null>(null);

  const tick = () => {
    const el = ref.current;
    if (!el || velocity.current === 0) {
      frame.current = null;
      return;
    }
    el.scrollLeft += velocity.current;
    frame.current = requestAnimationFrame(tick);
  };

  const setVelocity = (v: number) => {
    velocity.current = v;
    if (v !== 0 && frame.current === null) frame.current = requestAnimationFrame(tick);
  };

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <Tag
      ref={ref as React.Ref<never>}
      aria-label={label}
      className={className}
      onMouseMove={(e) => {
        const el = ref.current;
        if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        if (el.scrollWidth <= el.clientWidth) return setVelocity(0);
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        if (x < EDGE) setVelocity(-MAX_SPEED * (1 - x / EDGE));
        else if (x > 1 - EDGE) setVelocity(MAX_SPEED * (1 - (1 - x) / EDGE));
        else setVelocity(0);
      }}
      onMouseLeave={() => setVelocity(0)}
    >
      {children}
    </Tag>
  );
}
