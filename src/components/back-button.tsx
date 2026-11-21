"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** True once the visitor has moved between pages inside the site (set by NavTracker). */
let navigatedInApp = false;

/** Mounted once in the root layout: notes when the visitor navigates from one page to another. */
export function NavTracker() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else navigatedInApp = true;
  }, [pathname]);
  return null;
}

/**
 * Goes back to wherever you came from (the feed, a profile, search...). If this page was opened
 * directly (a shared link, a new tab) there's nothing to go back to, so it goes to `fallbackHref`.
 */
export function BackButton({
  fallbackHref,
  fallbackLabel,
}: {
  fallbackHref: string;
  /** Tooltip, e.g. "Back to Maya's profile". */
  fallbackLabel: string;
}) {
  const router = useRouter();

  function onClick() {
    const cameFromSite =
      navigatedInApp ||
      (document.referrer !== "" && new URL(document.referrer).origin === window.location.origin);
    if (cameFromSite && window.history.length > 1) router.back();
    else router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={fallbackLabel}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mb-3 -ml-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none focus-visible:ring-2"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back
    </button>
  );
}
