"use client";

import { Pin } from "lucide-react";
import { useState, useTransition } from "react";
import { togglePinAction } from "@/app/pins/actions";
import { Button } from "@/components/ui/button";

/** Owner-only: pin this review or shelf to the top of their profile, or take it down again. */
export function PinButton({
  kind,
  id,
  pinned: initial,
}: {
  kind: "review" | "shelf";
  id: string;
  pinned: boolean;
}) {
  const [pinned, setPinned] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function click() {
    setError(undefined);
    start(async () => {
      const res = await togglePinAction(kind, id);
      if (res.ok) setPinned(res.pinned);
      else setError(res.message);
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={click} disabled={pending}>
        <Pin aria-hidden className={pinned ? "fill-current" : undefined} />
        {pinned ? "Unpin" : "Pin to profile"}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
