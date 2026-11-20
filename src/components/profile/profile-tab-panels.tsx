"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ProfileTab } from "./tab-ids";

type Tab = { id: ProfileTab; label: string; count?: number; content: ReactNode };

/**
 * The profile's Reviews / Shelves / In rotation / Stats switcher. Every panel is rendered up front,
 * so switching is instant and never loads a page; the address bar still follows (`?tab=`) so a tab
 * can be shared or reloaded.
 */
export function ProfileTabPanels({
  handle,
  initial,
  tabs,
}: {
  handle: string;
  initial: ProfileTab;
  tabs: Tab[];
}) {
  const [active, setActive] = useState<ProfileTab>(initial);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  function select(id: ProfileTab) {
    setActive(id);
    try {
      window.history.replaceState(
        null,
        "",
        id === "reviews" ? `/u/${handle}` : `/u/${handle}?tab=${id}`,
      );
    } catch {
      // The address bar is a nicety; the tab has already switched.
    }
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    select(next.id);
    buttons.current[next.id]?.focus();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Profile sections"
        className="flex [scrollbar-width:none] gap-6 overflow-x-auto border-b [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              buttons.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className="-mb-px cursor-pointer border-b-2 border-transparent pb-2 text-sm whitespace-nowrap aria-selected:border-(--profile-accent) aria-selected:font-semibold"
          >
            {t.label}
            {t.count !== undefined && (
              <span className="text-muted-foreground font-normal"> {t.count}</span>
            )}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== active}
          className="space-y-3"
        >
          {t.content}
        </div>
      ))}
    </>
  );
}
