"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { blockAction, unblockAction } from "@/app/social/actions";

/** The "…" menu on someone else's profile: block / unblock. */
export function ProfileMenu({
  targetId,
  handle,
  blocked,
}: {
  targetId: string;
  handle: string;
  blocked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function toggle() {
    if (
      !blocked &&
      !confirm(
        `Block @${handle}? They won't be able to see your reviews or follow you, and you'll stop seeing theirs.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = blocked ? await unblockAction(targetId) : await blockAction(targetId);
      if (res.ok) router.refresh();
      else setError(res.message);
    });
  }

  return (
    <details className="relative">
      <summary
        aria-label="More actions"
        className="hover:bg-muted focus-visible:ring-ring flex size-8 cursor-pointer list-none items-center justify-center rounded-lg border outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </summary>
      <div className="bg-popover absolute right-0 z-20 mt-1 w-44 rounded-lg border p-1 shadow-md">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="hover:bg-muted w-full rounded-md px-3 py-1.5 text-left text-sm"
        >
          {blocked ? `Unblock @${handle}` : `Block @${handle}`}
        </button>
        {error && (
          <p role="alert" className="text-destructive px-3 py-1 text-xs">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
