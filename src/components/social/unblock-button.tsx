"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unblockAction } from "@/app/social/actions";
import { Button } from "@/components/ui/button";

export function UnblockButton({
  targetId,
  handle,
  variant = "default",
}: {
  targetId: string;
  handle: string;
  /** "blocked": a red "Blocked" pill that reads "Unblock" on hover, like other social sites. */
  variant?: "default" | "blocked";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const unblock = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await unblockAction(targetId);
      if (res.ok) router.refresh();
      else setError(res.message);
    });

  if (variant === "blocked") {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={unblock}
          aria-label={`Unblock @${handle}`}
          className="group h-8 cursor-pointer rounded-full bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
        >
          <span className="group-hover:hidden group-focus-visible:hidden">
            {pending ? "Unblocking…" : "Blocked"}
          </span>
          <span className="hidden group-hover:inline group-focus-visible:inline">Unblock</span>
        </button>
        {error && (
          <span role="alert" className="text-destructive text-xs">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const res = await unblockAction(targetId);
            if (res.ok) router.refresh();
            else setError(res.message);
          })
        }
      >
        {pending ? "Unblocking…" : `Unblock @${handle}`}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
