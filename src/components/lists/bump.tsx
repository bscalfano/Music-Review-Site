"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** How long a sleeve stays raised at least, so a quick pass still shows the whole hop. */
const MIN_RAISED_MS = 220;

/**
 * Rises while the pointer is over it and settles back when it leaves. If the pointer is gone
 * almost at once it still rises all the way before coming back down.
 */
export function Bump({
  lift,
  className,
  style,
  children,
}: {
  /** How far it rises, as a CSS length like "-1rem". */
  lift: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const raised = hovered || held;
  return (
    <div
      onMouseEnter={() => {
        setHovered(true);
        setHeld(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setHeld(false), MIN_RAISED_MS);
      }}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "transition-transform duration-200 ease-out motion-reduce:transition-none",
        className,
      )}
      style={{ ...style, transform: raised ? `translateY(${lift})` : undefined }}
    >
      {children}
    </div>
  );
}
