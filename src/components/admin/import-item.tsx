"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  publishAction,
  saveItemAction,
  skipAction,
  suggestAction,
} from "@/app/admin/import/actions";
import { AlbumPicker } from "@/components/album-picker";
import { StarInput } from "@/components/star-input";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import type { ImportMatch } from "@/db/schema/import";

export type ImportItemView = {
  id: string;
  caption: string;
  postedAt: string;
  title: string | null;
  body: string;
  rating: number | null;
  tags: string[];
  albumMbid: string | null;
  matches: ImportMatch[];
  error: string | null;
};

/** One staged Instagram post: confirm the album, tidy the text and rating, then publish or skip. */
export function ImportItem({ item }: { item: ImportItemView }) {
  const router = useRouter();
  const [title, setTitle] = useState(item.title ?? "");
  const [body, setBody] = useState(item.body);
  const [rating, setRating] = useState<number | null>(item.rating);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [albumMbid, setAlbumMbid] = useState<string | null>(item.albumMbid);
  const [matches, setMatches] = useState<ImportMatch[]>(item.matches);
  const [picked, setPicked] = useState<{ title: string; artist: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(item.error);
  const [pending, start] = useTransition();

  const edit = () => ({
    title: title.trim() || null,
    body,
    rating,
    albumMbid,
    tags: tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  });

  const chosen =
    matches.find((m) => m.mbid === albumMbid) ??
    (albumMbid && picked ? { mbid: albumMbid, ...picked, releaseDate: null } : null);

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
        <time dateTime={item.postedAt}>
          {new Date(item.postedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
        </time>
        <span>Original caption</span>
      </div>
      <p className="bg-muted/50 max-h-32 overflow-y-auto rounded-md p-2 text-sm whitespace-pre-wrap">
        {item.caption || "(no caption)"}
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Album</legend>
        {chosen && (
          <p className="text-sm">
            ✓ <strong>{chosen.title}</strong> by {chosen.artist}
          </p>
        )}
        {matches.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {matches.map((m) => (
              <li key={m.mbid}>
                <button
                  type="button"
                  aria-pressed={m.mbid === albumMbid}
                  onClick={() => setAlbumMbid(m.mbid)}
                  className="hover:bg-muted aria-pressed:border-foreground rounded-full border px-3 py-1 text-xs"
                >
                  {m.title} · {m.artist}
                  {m.releaseDate ? ` (${m.releaseDate.slice(0, 4)})` : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await suggestAction(item.id);
                setMatches(res.matches);
                setMessage(res.matches.length ? null : "No matches found. Search by hand.");
                if (res.matches.length === 1) setAlbumMbid((cur) => cur ?? res.matches[0].mbid);
              })
            }
          >
            Find matches
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSearching((s) => !s)}>
            {searching ? "Close search" : "Search by hand"}
          </Button>
        </div>
        {searching && (
          <AlbumPicker
            onPick={(a) => {
              setAlbumMbid(a.mbid);
              setPicked({ title: a.title, artist: a.artistName });
              setSearching(false);
            }}
          />
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`t-${item.id}`}>Title (optional)</Label>
          <Input id={`t-${item.id}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`g-${item.id}`}>Tags (comma separated)</Label>
          <Input id={`g-${item.id}`} value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`b-${item.id}`}>Review text</Label>
        <Textarea
          id={`b-${item.id}`}
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <StarInput value={rating} onChange={setRating} size={24} allowClear />
        <span className="text-muted-foreground text-xs">
          {rating === null ? "No rating" : `${rating / 2} stars`}
        </span>
      </div>

      {message && (
        <p role="alert" className="text-sm">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || !albumMbid}
          onClick={() =>
            start(async () => {
              await saveItemAction(item.id, edit());
              const [outcome] = await publishAction([item.id]);
              if (outcome && !outcome.ok) setMessage(outcome.message);
              else router.refresh();
            })
          }
        >
          Publish
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await saveItemAction(item.id, edit());
              setMessage("Saved.");
              router.refresh();
            })
          }
        >
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await skipAction([item.id], true);
              router.refresh();
            })
          }
        >
          Skip
        </Button>
      </div>
    </li>
  );
}
