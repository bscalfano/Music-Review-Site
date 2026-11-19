"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toggleHeartAction } from "@/app/social/actions";
import { cn } from "@/lib/utils";

/** Heart on a review or comment. Updates instantly; rolls back if the server refuses. */
export function HeartButton({
  targetType,
  targetId,
  count: initialCount,
  hearted: initialHearted,
  signInHref,
  label,
  className,
}: {
  targetType: "review" | "comment";
  targetId: string;
  count: number;
  hearted: boolean;
  /** Set when signed out: the button becomes a link to sign in. */
  signInHref?: string;
  label: string;
  className?: string;
}) {
  const [hearted, setHearted] = useState(initialHearted);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const body = (
    <>
      <Heart className={cn("size-4", hearted && "fill-current")} aria-hidden />
      {/* Fixed line height and a minimum width so the first like doesn't change the button's size. */}
      <span className="inline-block h-4 min-w-[1.5ch] leading-4 tabular-nums">
        {count > 0 ? count : ""}
      </span>
    </>
  );
  const classes = cn(
    "inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm transition-colors",
    hearted
      ? "text-(--profile-accent,var(--primary))"
      : "text-muted-foreground hover:text-foreground",
    className,
  );

  if (signInHref) {
    return (
      <Link href={signInHref} className={classes} aria-label={`${label} (sign in to like)`}>
        {body}
      </Link>
    );
  }

  function click() {
    const before = { hearted, count };
    setError(undefined);
    setHearted(!hearted);
    setCount(count + (hearted ? -1 : 1));
    startTransition(async () => {
      const res = await toggleHeartAction(targetType, targetId);
      if (res.ok) {
        setHearted(res.hearted);
        setCount(res.count);
      } else {
        setHearted(before.hearted);
        setCount(before.count);
        setError(res.message);
      }
    });
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={click}
        disabled={pending}
        aria-pressed={hearted}
        aria-label={`${hearted ? "Unlike" : "Like"}: ${label}`}
        className={classes}
      >
        {body}
      </button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
