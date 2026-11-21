"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  unblockAction,
  unmuteAction,
  updateAcceptSuggestionsAction,
  updateEmailNotificationsAction,
} from "@/app/social/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { AvatarView } from "@/components/avatar-view";

type Option = { type: string; label: string };

/** Which notifications also arrive by email. In-app notifications are always on. */
export function NotificationPrefsForm({
  options,
  enabled,
  emailConfigured,
}: {
  options: Option[];
  enabled: string[];
  emailConfigured: boolean;
}) {
  const [selected, setSelected] = useState(new Set(enabled));
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();

  function toggle(type: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(type);
    else next.delete(type);
    setSelected(next);
    setMessage(undefined);
    start(async () => setMessage((await updateEmailNotificationsAction([...next])).message));
  }

  return (
    <fieldset className="space-y-3" disabled={pending}>
      <legend className="text-muted-foreground mb-1 text-sm">
        Email me when… (you always see these in the app, under the bell)
      </legend>
      {options.map((o) => (
        <Label key={o.type} className="flex items-center gap-3 font-normal">
          <input
            type="checkbox"
            className="size-4"
            checked={selected.has(o.type)}
            onChange={(e) => toggle(o.type, e.target.checked)}
          />
          {o.label}
        </Label>
      ))}
      {!emailConfigured && (
        <p className="text-muted-foreground text-xs">
          Email sending isn&apos;t set up on this site yet, so nothing is emailed for now.
        </p>
      )}
      {message && (
        <p role="status" className="text-muted-foreground text-sm">
          {message}
        </p>
      )}
    </fieldset>
  );
}

type Blocked = {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
};

export function BlockedList({
  people,
  kind = "block",
}: {
  people: Blocked[];
  /** "mute" reuses this list for muted accounts. */
  kind?: "block" | "mute";
}) {
  const undo = kind === "mute" ? unmuteAction : unblockAction;
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const shown = people.filter((p) => !removed.has(p.id));

  if (shown.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        You haven&apos;t {kind === "mute" ? "muted" : "blocked"} anyone.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {shown.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-2">
          <AvatarView src={p.avatar} name={p.displayName ?? p.handle ?? "?"} size={32} />
          <span className="min-w-0 flex-1 truncate text-sm">
            {p.displayName ?? p.handle}{" "}
            <Link href={`/u/${p.handle}`} className="text-muted-foreground hover:underline">
              @{p.handle}
            </Link>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await undo(p.id);
                if (res.ok) setRemoved((s) => new Set(s).add(p.id));
              })
            }
          >
            {kind === "mute" ? "Unmute" : "Unblock"}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** S14: whether other people may suggest albums for your queue. */
export function SuggestionsForm({ accept }: { accept: boolean }) {
  const [value, setValue] = useState(accept);
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Label className="flex items-start gap-3 font-normal">
        <input
          type="checkbox"
          checked={value}
          disabled={pending}
          className="mt-0.5 size-4"
          onChange={(e) => {
            const next = e.target.checked;
            setValue(next);
            start(async () => setMessage((await updateAcceptSuggestionsAction(next)).message));
          }}
        />
        <span>
          <span className="font-medium">Let people suggest albums for my queue</span>
          <span className="text-muted-foreground block text-sm">
            Suggestions only reach you; you accept or dismiss each one.
          </span>
        </span>
      </Label>
      {message && (
        <p role="status" className="text-muted-foreground text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
