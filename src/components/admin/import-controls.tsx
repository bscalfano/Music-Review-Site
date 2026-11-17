"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  clearStagedAction,
  publishAction,
  skipAction,
  uploadExportAction,
  type UploadState,
} from "@/app/admin/import/actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadExportAction, null);
  return (
    <form action={action} className="space-y-2">
      <Label htmlFor="export-file">Instagram posts file (posts_1.json)</Label>
      <div className="flex flex-wrap gap-2">
        <Input id="export-file" name="file" type="file" accept=".json,application/json" />
        <Button type="submit" disabled={pending}>
          {pending ? "Reading…" : "Add posts"}
        </Button>
      </div>
      {state && (
        <p role="status" className={state.ok ? "text-sm" : "text-destructive text-sm"}>
          {state.message}
        </p>
      )}
    </form>
  );
}

/** Buttons that act on every item shown on the current page. */
export function BulkBar({
  readyIds,
  allIds,
  mode,
}: {
  /** Pending items on this page that already have an album chosen. */
  readyIds: string[];
  allIds: string[];
  mode: "pending" | "skipped" | "imported";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (mode === "imported" || allIds.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === "pending" ? (
        <Button
          type="button"
          disabled={pending || readyIds.length === 0}
          onClick={() =>
            start(async () => {
              const outcomes = await publishAction(readyIds);
              const failed = outcomes.filter((o) => !o.ok).length;
              setMessage(`Published ${outcomes.length - failed}, ${failed} need attention.`);
              router.refresh();
            })
          }
        >
          Publish {readyIds.length} with a saved album
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await skipAction(allIds, false);
              router.refresh();
            })
          }
        >
          Restore these {allIds.length}
        </Button>
      )}
      {message && (
        <span role="status" className="text-sm">
          {message}
        </span>
      )}
    </div>
  );
}

export function ClearButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Remove all un-published staged posts? Published reviews stay."))
          return;
        start(async () => {
          await clearStagedAction();
          router.refresh();
        });
      }}
    >
      Clear staged posts
    </Button>
  );
}
