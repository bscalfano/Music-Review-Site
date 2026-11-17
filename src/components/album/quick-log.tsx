"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { quickRateAction, removeLogAction } from "@/app/albums/actions";
import { StarInput } from "@/components/star-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MyState = {
  id: string;
  rating: number | null;
  hasBody: boolean;
  status: "draft" | "published" | "hidden";
} | null;

/**
 * "Your panel" (S23): click a star to log the album in one step. Clicking your current rating
 * clears it (the log stays as "listened"). The full editor is one click away.
 */
export function QuickLog({
  albumId,
  albumMbid,
  mine,
  compact = false,
}: {
  albumId: string;
  albumMbid: string;
  mine: MyState;
  /** Mobile bottom bar: stars and a Review button only. */
  compact?: boolean;
}) {
  const [rating, setRating] = useState<number | null>(mine?.rating ?? null);
  const [logged, setLogged] = useState(mine?.status === "published");
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const isDraft = mine?.status === "draft";
  const isHidden = mine?.status === "hidden";

  function rate(next: number | null) {
    const before = { rating, logged };
    setRating(next);
    setLogged(!isDraft);
    setMessage(undefined);
    startTransition(async () => {
      const res = await quickRateAction(albumId, next);
      if (!res.ok) {
        setRating(before.rating);
        setLogged(before.logged);
        setMessage(res.message);
      } else if (res.draft) {
        setMessage("Saved to your draft. Publish it to log this album.");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await removeLogAction(albumId);
      if (res.ok) {
        setRating(null);
        setLogged(false);
      } else setMessage(res.message);
    });
  }

  const editHref = mine ? `/write/${mine.id}` : `/write?album=${albumMbid}`;
  const editLabel = mine?.hasBody ? "Edit review" : "Write a review";

  if (isHidden) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Your review of this album was taken down by a moderator, so it can&apos;t be changed here.
      </p>
    );
  }

  return (
    <div
      className={cn("space-y-3", compact && "flex items-center justify-between gap-3 space-y-0")}
    >
      <div className="space-y-1">
        {!compact && (
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {logged ? "You rated this" : "Rate"}
          </p>
        )}
        <StarInput
          value={rating}
          onChange={rate}
          allowClear
          size={compact ? 26 : 32}
          label="Your rating"
          disabled={pending}
        />
      </div>

      {!compact && (
        <div className="flex flex-wrap gap-2">
          {!logged && !isDraft && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => rate(null)}
            >
              Mark as listened
            </Button>
          )}
          {logged && !mine?.hasBody && (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove}>
              Remove from my log
            </Button>
          )}
        </div>
      )}

      <Link
        href={editHref}
        className={buttonVariants({
          variant: compact ? "default" : "outline",
          size: compact ? "default" : "sm",
        })}
      >
        {isDraft ? "Continue draft" : editLabel}
      </Link>

      {message && !compact && (
        <p role="status" className="text-muted-foreground text-xs">
          {message}
        </p>
      )}
    </div>
  );
}
