"use client";

import { useState, useTransition } from "react";
import { respondToRequestAction } from "@/app/social/actions";
import { Button } from "@/components/ui/button";

/** Accept / Decline buttons for one pending follow request. */
export function RequestActions({ followerId }: { followerId: string }) {
  const [result, setResult] = useState<"accepted" | "declined" | string>();
  const [pending, startTransition] = useTransition();

  if (result === "accepted") return <span className="text-muted-foreground text-sm">Accepted</span>;
  if (result === "declined") return <span className="text-muted-foreground text-sm">Declined</span>;

  function respond(accept: boolean) {
    startTransition(async () => {
      const res = await respondToRequestAction(followerId, accept);
      setResult(res.ok ? (accept ? "accepted" : "declined") : res.message);
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => respond(true)}>
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => respond(false)}
        >
          Decline
        </Button>
      </span>
      {result && (
        <span role="alert" className="text-destructive text-xs">
          {result}
        </span>
      )}
    </span>
  );
}
