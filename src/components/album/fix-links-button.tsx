"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { fixLinksAction } from "@/app/albums/actions";

/** Admins only: throw away the stored streaming links and look them up again. */
export function FixLinksButton({ albumId }: { albumId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={pending || done}
      className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 disabled:no-underline"
      onClick={() =>
        start(async () => {
          await fixLinksAction(albumId);
          setDone(true);
          router.refresh();
        })
      }
    >
      {done ? "Looking again…" : pending ? "Working…" : "Fix links"}
    </button>
  );
}
