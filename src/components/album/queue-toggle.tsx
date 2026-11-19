"use client";

import { ListPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addToQueueAction, removeFromQueueAction } from "@/app/queue/actions";

/** "Add to my queue" / "In your queue" on an album page (S14). */
export function QueueToggle({
  albumId,
  albumMbid,
  queued: initial,
}: {
  albumId: string;
  albumMbid: string;
  queued: boolean;
}) {
  const router = useRouter();
  const [queued, setQueued] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        aria-pressed={queued}
        className="hover:bg-muted inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm disabled:opacity-60"
        onClick={() =>
          start(async () => {
            setMessage(null);
            const res = queued
              ? await removeFromQueueAction(albumId)
              : await addToQueueAction(albumMbid);
            if (res.ok) setQueued(!queued);
            else setMessage(res.message);
            router.refresh();
          })
        }
      >
        <ListPlus className="size-4" aria-hidden />
        {queued ? "In your queue" : "Add to queue"}
      </button>
      {message && (
        <p role="alert" className="text-destructive text-xs">
          {message}
        </p>
      )}
    </div>
  );
}
