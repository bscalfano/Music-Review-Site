"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteListAction, saveListAction } from "@/app/shelves/actions";
import { AlbumPicker } from "@/components/album-picker";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  MAX_LIST_DESCRIPTION,
  MAX_LIST_ITEMS,
  MAX_LIST_NOTE,
  MAX_LIST_TITLE,
} from "@/lib/lists/limits";

export type EditorItem = {
  mbid: string;
  title: string;
  artistName: string;
  coverUrl: string;
  note: string;
};

export type EditorInitial = {
  title: string;
  description: string;
  ranked: boolean;
  year: number | null;
  status: "draft" | "published";
  items: EditorItem[];
};

/** Create or edit a list: title, ranked or not, optional year, and albums with notes. */
export function ListEditor({
  listId,
  initial,
}: {
  listId: string | null;
  initial: EditorInitial | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [ranked, setRanked] = useState(initial?.ranked ?? true);
  const [year, setYear] = useState(initial?.year ? String(initial.year) : "");
  const [items, setItems] = useState<EditorItem[]>(initial?.items ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const move = (from: number, to: number) =>
    setItems((cur) => {
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  function save(status: "draft" | "published") {
    setError(null);
    const yearNumber = year.trim() === "" ? null : Number(year);
    if (yearNumber !== null && !Number.isInteger(yearNumber)) {
      setError("Year should be a four-digit number, like 2025.");
      return;
    }
    start(async () => {
      const res = await saveListAction(listId, {
        title,
        description,
        ranked,
        year: yearNumber,
        status,
        items: items.map((i) => ({ albumMbid: i.mbid, note: i.note })),
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      router.push(
        status === "published"
          ? `/shelves/${res.handle}/${res.slug}`
          : `/u/${res.handle}?tab=shelves`,
      );
      router.refresh();
    });
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{listId ? "Edit shelf" : "New shelf"}</h1>

      <div className="space-y-1.5">
        <Label htmlFor="list-title">Title</Label>
        <Input
          id="list-title"
          value={title}
          maxLength={MAX_LIST_TITLE}
          placeholder="Favorite albums of 2025"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="list-desc">Description (optional)</Label>
        <Textarea
          id="list-desc"
          rows={3}
          value={description}
          maxLength={MAX_LIST_DESCRIPTION}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <Label className="flex items-center gap-2 font-normal">
          <input
            type="checkbox"
            checked={ranked}
            className="size-4"
            onChange={(e) => setRanked(e.target.checked)}
          />
          Ranked (numbered 1, 2, 3…)
        </Label>
        <div className="space-y-1.5">
          <Label htmlFor="list-year">Year (optional)</Label>
          <Input
            id="list-year"
            className="w-28"
            inputMode="numeric"
            maxLength={4}
            placeholder="2025"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
      </div>

      <section aria-labelledby="albums-heading" className="space-y-3">
        <h2 id="albums-heading" className="text-sm font-semibold tracking-wide uppercase">
          Albums <span className="text-muted-foreground font-normal">{items.length}</span>
        </h2>
        {items.length > 0 && (
          <ol className="space-y-3">
            {items.map((item, i) => (
              <li key={item.mbid} className="flex gap-3 rounded-lg border p-3">
                <span
                  className="text-muted-foreground w-6 shrink-0 pt-1 text-right text-sm tabular-nums"
                  aria-hidden
                >
                  {ranked ? i + 1 : "•"}
                </span>
                <Image
                  src={item.coverUrl}
                  alt=""
                  width={56}
                  height={56}
                  unoptimized
                  className="bg-muted size-14 shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="truncate text-sm font-medium">
                    {item.title}
                    <span className="text-muted-foreground font-normal"> · {item.artistName}</span>
                  </p>
                  <Input
                    aria-label={`Note for ${item.title}`}
                    placeholder="A note about this one (optional)"
                    value={item.note}
                    maxLength={MAX_LIST_NOTE}
                    onChange={(e) =>
                      setItems((cur) =>
                        cur.map((c, j) => (j === i ? { ...c, note: e.target.value } : c)),
                      )
                    }
                  />
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${item.title} up`}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                    className="hover:bg-muted rounded p-1 disabled:opacity-30"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.title} down`}
                    disabled={i === items.length - 1}
                    onClick={() => move(i, i + 1)}
                    className="hover:bg-muted rounded p-1 disabled:opacity-30"
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.title}`}
                    onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}
                    className="hover:bg-muted rounded p-1"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {items.length < MAX_LIST_ITEMS ? (
          <div className="space-y-1.5">
            <Label>Add an album</Label>
            <AlbumPicker
              excludeMbids={items.map((i) => i.mbid)}
              onPick={(a) =>
                setItems((cur) => [
                  ...cur,
                  {
                    mbid: a.mbid,
                    title: a.title,
                    artistName: a.artistName,
                    coverUrl: a.coverUrl,
                    note: "",
                  },
                ])
              }
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Shelves can hold up to {MAX_LIST_ITEMS} albums.
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => save("published")}>
          {pending ? "Saving…" : initial?.status === "published" ? "Save" : "Publish"}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => save("draft")}>
          {initial?.status === "published" ? "Unpublish (save as draft)" : "Save draft"}
        </Button>
        {listId && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Delete this shelf? This can't be undone.")) return;
              start(async () => {
                await deleteListAction(listId);
                router.push("/");
                router.refresh();
              });
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </main>
  );
}
