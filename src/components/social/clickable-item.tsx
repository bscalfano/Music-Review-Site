"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

const INTERACTIVE =
  "a, button, input, select, textarea, label, audio, video, summary, [role='button']";

/**
 * A list item that opens `href` when you click anywhere on it that isn't already a link or
 * control (so names, covers, hearts and the clip button keep doing their own thing). Dragging to
 * select text doesn't count as a click. Cmd/Ctrl-click opens a new tab.
 */
export function ClickableItem({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function onClick(e: MouseEvent<HTMLLIElement>) {
    if (e.defaultPrevented || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  }

  return (
    <li onClick={onClick} className={`cursor-pointer ${className ?? ""}`}>
      {children}
    </li>
  );
}
