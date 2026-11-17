"use client";

import { Flag } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { reportAction } from "@/app/moderation/actions";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { MAX_REPORT_DETAILS, REPORT_REASONS } from "@/lib/moderation/reasons";
import { cn } from "@/lib/utils";

/**
 * "Report" for a review, comment or profile. Opens a small dialog asking why. Signed-out visitors
 * get a link to sign in instead.
 */
export function ReportButton({
  targetType,
  targetId,
  subject,
  signInHref,
  variant = "link",
  className,
}: {
  targetType: "review" | "comment" | "user";
  targetId: string;
  /** What is being reported, for screen readers: "review of Kid A", "comment by @sam". */
  subject: string;
  signInHref?: string;
  variant?: "link" | "menu";
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].slug);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "done" | "error"; message?: string }>({
    kind: "idle",
  });
  const [pending, start] = useTransition();

  const trigger = cn(
    variant === "menu"
      ? "hover:bg-muted w-full rounded-md px-3 py-1.5 text-left text-sm"
      : "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs",
    className,
  );

  if (signInHref) {
    return (
      <Link href={signInHref} className={trigger}>
        {variant === "link" && <Flag className="size-3.5" aria-hidden />}
        Report
      </Link>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await reportAction({ targetType, targetId, reason, details });
      if (res.ok) setState({ kind: "done" });
      else setState({ kind: "error", message: res.message });
    });
  }

  return (
    <>
      <button
        type="button"
        className={trigger}
        aria-label={`Report ${subject}`}
        onClick={() => {
          setState({ kind: "idle" });
          dialog.current?.showModal();
        }}
      >
        {variant === "link" && <Flag className="size-3.5" aria-hidden />}
        Report
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={`report-${targetId}`}
        className="bg-background text-foreground m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border p-5 shadow-lg backdrop:bg-black/50"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        {state.kind === "done" ? (
          <div className="space-y-4">
            <h2 id={`report-${targetId}`} className="text-lg font-semibold">
              Thanks for letting us know
            </h2>
            <p className="text-muted-foreground text-sm">
              A moderator will take a look. We won&apos;t tell them who reported it.
            </p>
            <Button type="button" onClick={() => dialog.current?.close()}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <h2 id={`report-${targetId}`} className="text-lg font-semibold">
              Report {subject}
            </h2>
            <fieldset className="space-y-2">
              <legend className="sr-only">Reason</legend>
              {REPORT_REASONS.map((r) => (
                <Label key={r.slug} className="flex items-center gap-2 font-normal">
                  <input
                    type="radio"
                    name={`reason-${targetId}`}
                    value={r.slug}
                    checked={reason === r.slug}
                    onChange={() => setReason(r.slug)}
                  />
                  {r.label}
                </Label>
              ))}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor={`details-${targetId}`}>
                Anything else we should know? (optional)
              </Label>
              <Textarea
                id={`details-${targetId}`}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={MAX_REPORT_DETAILS}
                rows={3}
              />
            </div>
            {state.kind === "error" && (
              <p role="alert" className="text-destructive text-sm">
                {state.message}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Sending…" : "Send report"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
