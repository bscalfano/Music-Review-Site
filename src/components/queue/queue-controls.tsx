"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addToQueueAction,
  removeFromQueueAction,
  respondToSuggestionAction,
  suggestAlbumAction,
} from "@/app/queue/actions";
import { AlbumPicker } from "@/components/album-picker";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { MAX_QUEUE_NOTE } from "@/lib/queue/limits";

/** Owner only: add any album to your own queue. */
export function QueueAdder() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Label>Add an album to your queue</Label>
      <AlbumPicker
        onPick={(a) =>
          start(async () => {
            const res = await addToQueueAction(a.mbid);
            setMessage(res.ok ? `${a.title}: ${res.message ?? "Added."}` : res.message);
            router.refresh();
          })
        }
      />
      {pending && <p className="text-muted-foreground text-sm">Adding…</p>}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

export function RemoveFromQueueButton({ albumId, title }: { albumId: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${title} from your queue`}
      className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
      onClick={() =>
        start(async () => {
          await removeFromQueueAction(albumId);
          router.refresh();
        })
      }
    >
      Remove
    </button>
  );
}

/** Accept or dismiss one suggestion. */
export function SuggestionActions({ itemId, title }: { itemId: string; title: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const respond = (accept: boolean) =>
    start(async () => {
      const res = await respondToSuggestionAction(itemId, accept);
      if (!res.ok) setError(res.message);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        aria-label={`Add ${title} to my queue`}
        onClick={() => respond(true)}
      >
        Add to queue
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label={`Dismiss suggestion ${title}`}
        onClick={() => respond(false)}
      >
        Dismiss
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </div>
  );
}

/** For visitors: suggest an album for this person's queue. */
export function SuggestForm({
  ownerId,
  ownerName,
  signInHref,
}: {
  ownerId: string;
  ownerName: string;
  signInHref?: string;
}) {
  const [picked, setPicked] = useState<{ mbid: string; title: string; artist: string } | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (signInHref) {
    return (
      <p className="text-muted-foreground text-sm">
        <Link href={signInHref} className="underline">
          Sign in
        </Link>{" "}
        to suggest an album for {ownerName}.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Label>Suggest an album for {ownerName}</Label>
      {picked ? (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm">
            <strong>{picked.title}</strong> by {picked.artist}
          </p>
          <Input
            aria-label="A note (optional)"
            placeholder="Why they might like it (optional)"
            maxLength={MAX_QUEUE_NOTE}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await suggestAlbumAction(ownerId, picked.mbid, note);
                  setMessage({ ok: res.ok, text: res.message ?? (res.ok ? "Sent." : "") });
                  if (res.ok) {
                    setPicked(null);
                    setNote("");
                  }
                })
              }
            >
              {pending ? "Sending…" : "Send suggestion"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Pick a different album
            </Button>
          </div>
        </div>
      ) : (
        <AlbumPicker
          onPick={(a) => {
            setMessage(null);
            setPicked({ mbid: a.mbid, title: a.title, artist: a.artistName });
          }}
        />
      )}
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-sm" : "text-destructive text-sm"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
