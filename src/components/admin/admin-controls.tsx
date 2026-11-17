"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  handleReportAction,
  resetImageAction,
  setRoleAction,
  suspendUserAction,
  unhideReviewAction,
  unsuspendUserAction,
  restoreCommentAction,
  type ReportDecision,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

type Result = { ok: boolean; message?: string };

function useAdminAction() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setError(undefined);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.message);
    });
  };
  return { run, pending, error };
}

/** The buttons under one reported item. */
export function ReportActions({
  targetType,
  targetId,
  canHide,
  canSuspend,
}: {
  targetType: "review" | "comment" | "user";
  targetId: string;
  /** False when the content is already hidden/removed. */
  canHide: boolean;
  canSuspend: boolean;
}) {
  const { run, pending, error } = useAdminAction();
  const decide = (d: ReportDecision, confirmText?: string) => () =>
    run(() => handleReportAction(targetType, targetId, d), confirmText);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {targetType !== "user" && canHide && (
          <Button type="button" size="sm" disabled={pending} onClick={decide("hide_content")}>
            {targetType === "review" ? "Hide review" : "Remove comment"}
          </Button>
        )}
        {canSuspend && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={decide(
              "suspend_author",
              targetType === "user"
                ? "Suspend this account? They\x27ll be signed out immediately."
                : "Suspend the author and take this down?",
            )}
          >
            Suspend {targetType === "user" ? "account" : "author"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={decide("dismiss")}
        >
          Dismiss
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** Per-user controls on the Users tab. */
export function UserControls({
  userId,
  suspended,
  isTargetAdmin,
  isOwnerViewer,
  isSelfOrOwner,
}: {
  userId: string;
  suspended: boolean;
  isTargetAdmin: boolean;
  isOwnerViewer: boolean;
  /** The row is the viewer or the owner: nothing destructive is offered. */
  isSelfOrOwner: boolean;
}) {
  const { run, pending, error } = useAdminAction();
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {!isSelfOrOwner &&
          (suspended ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => unsuspendUserAction(userId))}
            >
              Unsuspend
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(
                  () => suspendUserAction(userId),
                  "Suspend this account? They\x27ll be signed out.",
                )
              }
            >
              Suspend
            </Button>
          ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => resetImageAction(userId, "avatar"), "Reset this avatar?")}
        >
          Reset avatar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => resetImageAction(userId, "banner"), "Reset this banner?")}
        >
          Reset banner
        </Button>
        {isOwnerViewer && !isSelfOrOwner && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => setRoleAction(userId, isTargetAdmin ? "member" : "admin"))}
          >
            {isTargetAdmin ? "Remove admin" : "Make admin"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** Undo for a taken-down review or comment (shown on already-handled items). */
export function RestoreButton({ kind, id }: { kind: "review" | "comment"; id: string }) {
  const { run, pending, error } = useAdminAction();
  return (
    <span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(() => (kind === "review" ? unhideReviewAction(id) : restoreCommentAction(id)))
        }
      >
        Restore
      </Button>
      {error && <span className="text-destructive ml-2 text-xs">{error}</span>}
    </span>
  );
}
