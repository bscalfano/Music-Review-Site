"use client";

import { useEffect, useRef } from "react";

/**
 * The avatar dropdown. A native <details>, so it works without JavaScript, plus the behaviour
 * people expect: it closes when you pick something, click elsewhere, or press Escape.
 */
export function AccountMenu({
  avatar,
  children,
}: {
  avatar: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = () => ref.current?.removeAttribute("open");
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        className="focus-visible:ring-ring/50 flex cursor-pointer list-none items-center rounded-full outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden"
        aria-label="Account menu"
      >
        {avatar}
      </summary>
      <div
        className="bg-popover absolute right-0 z-50 mt-2 w-48 rounded-lg border p-1 shadow-md"
        onClick={(e) => {
          // Any link or button inside the menu closes it.
          if ((e.target as HTMLElement).closest("a, button")) ref.current?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}
