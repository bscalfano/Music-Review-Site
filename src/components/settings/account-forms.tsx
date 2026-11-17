"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/app/account/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/** Download-my-data link and the delete-account flow (typed confirmation, 30-day grace period). */
export function YourDataSection({ handle, graceDays }: { handle: string; graceDays: number }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    start(async () => {
      const res = await deleteAccountAction(confirmation);
      if (res && !res.ok) setError(res.message);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm">
          Download everything we store about you (profile, reviews including drafts, comments,
          follows and more) as a single JSON file.
        </p>
        <a
          href="/api/account/export"
          className={buttonVariants({ variant: "outline", size: "sm" })}
          download
        >
          Download my data
        </a>
      </div>

      <div className="border-destructive/30 space-y-3 rounded-lg border p-4">
        <div>
          <h3 className="text-destructive font-medium">Delete my account</h3>
          <p className="text-muted-foreground text-sm">
            Your profile, reviews and comments disappear from the site right away. After {graceDays}{" "}
            days everything is permanently erased, including your uploaded images. If you change
            your mind, signing in again within {graceDays} days brings it all back.
          </p>
        </div>
        {!open ? (
          <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
            Delete my account…
          </Button>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="confirm-handle">
                Type <strong>{handle}</strong> to confirm
              </Label>
              <Input
                id="confirm-handle"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
              />
            </div>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={pending || !confirmation}
              >
                {pending ? "Deleting…" : "Permanently delete"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
