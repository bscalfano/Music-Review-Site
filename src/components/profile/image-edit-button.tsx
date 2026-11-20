"use client";

import { Camera } from "lucide-react";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EditContext } from "./profile-edit";

/**
 * Shown on top of the avatar or banner while the owner is editing their profile. Clicking it opens
 * a dialog with the upload / crop / remove controls (passed in as children), right on the page.
 */
export function ImageEditButton({
  kind,
  children,
}: {
  kind: "avatar" | "banner";
  children: ReactNode;
}) {
  const { editing } = useContext(EditContext);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const label = kind === "avatar" ? "Change avatar" : "Change banner";

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Leaving edit mode closes the dialog too.
  const visible = editing;
  useEffect(() => {
    if (!editing) setOpen(false);
  }, [editing]);

  if (!visible) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={
          kind === "avatar"
            ? "absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/60"
            : "absolute right-3 bottom-3 flex cursor-pointer items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-black/75"
        }
      >
        <Camera className={kind === "avatar" ? "size-6" : "size-4"} aria-hidden />
        {kind === "banner" && label}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself) closes it.
          if (e.target === dialog.current) setOpen(false);
        }}
        aria-label={label}
        className="bg-background text-foreground m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border p-5 shadow-xl backdrop:bg-black/50"
      >
        {open && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{label}</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
            {children}
          </div>
        )}
      </dialog>
    </>
  );
}
