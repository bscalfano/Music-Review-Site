"use client";

import { useState, useTransition } from "react";
import { followAction, unfollowAction } from "@/app/social/actions";
import { Button } from "@/components/ui/button";
import type { FollowState } from "@/lib/social/visibility";

/**
 * Follow / Request to follow / Requested / Following. Clicking a pending request withdraws it;
 * clicking "Following" unfollows. The button updates at once and rolls back if the server says no.
 */
export function FollowButton({
  targetId,
  initial,
  isPrivate,
  size = "sm",
}: {
  targetId: string;
  initial: FollowState;
  isPrivate: boolean;
  size?: "sm" | "default";
}) {
  const [state, setState] = useState<FollowState>(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function click() {
    const before = state;
    setError(undefined);
    startTransition(async () => {
      if (before === null) {
        setState(isPrivate ? "pending" : "accepted");
        const res = await followAction(targetId);
        if (res.ok) setState(res.state);
        else {
          setState(before);
          setError(res.message);
        }
      } else {
        setState(null);
        const res = await unfollowAction(targetId);
        if (!res.ok) {
          setState(before);
          setError(res.message);
        }
      }
    });
  }

  const label =
    state === "accepted"
      ? "Following"
      : state === "pending"
        ? "Requested"
        : isPrivate
          ? "Request to follow"
          : "Follow";

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size={size}
        variant={state === null ? "default" : "outline"}
        disabled={pending}
        onClick={click}
        aria-pressed={state !== null}
      >
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-destructive max-w-48 text-right text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
