"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pin, Plus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { listPinCandidatesAction, reorderPinsAction, togglePinAction } from "@/app/pins/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import type { PinCandidate } from "@/lib/pins/service";

/** One pinned card; `body` is rendered on the server and handed in. */
export type PinnedItem = { id: string; href: string; label: string; body: ReactNode };

type Kind = "review" | "shelf";

/** Keeps the order on screen (including unsaved dragging); anything new goes at the end. */
function mergeOrder(local: PinnedItem[], server: PinnedItem[]): PinnedItem[] {
  const byId = new Map(server.map((p) => [p.id, p]));
  const kept = local.filter((p) => byId.has(p.id)).map((p) => byId.get(p.id)!);
  const keptIds = new Set(kept.map((p) => p.id));
  return [...kept, ...server.filter((p) => !keptIds.has(p.id))];
}

/** A card that is a link normally and a drag handle while the owner is arranging. */
function Card({
  id,
  editing,
  href,
  label,
  onRemove,
  children,
}: {
  id: string;
  editing: boolean;
  href: string;
  label: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editing,
  });
  if (!editing) {
    return (
      <li>
        <Link href={href} className="block space-y-2">
          {children}
        </Link>
      </li>
    );
  }
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`ring-dashed relative cursor-grab touch-none rounded-md p-1 ring-1 select-none active:cursor-grabbing ${isDragging ? "bg-background ring-ring z-10 shadow-lg ring-2" : "ring-border"}`}
    >
      <div className="pointer-events-none space-y-2">{children}</div>
      <button
        type="button"
        aria-label={`Remove ${label} from your pins`}
        title="Remove from pins"
        // Keep the click from starting a drag of the card underneath.
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/** An empty spot the owner can fill. */
function EmptySlot({
  kind,
  active,
  onClick,
}: {
  kind: Kind;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={active}
        className={`text-muted-foreground hover:text-foreground flex w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-sm transition-colors ${kind === "review" ? "aspect-square" : "h-28"} ${active ? "border-ring text-foreground" : ""}`}
      >
        <Plus className="size-5" aria-hidden />
        Add pin
      </button>
    </li>
  );
}

/** Inline list of the owner's unpinned reviews or shelves. Picking one pins it. */
function Picker({
  kind,
  items,
  error,
  busy,
  onPick,
  onClose,
}: {
  kind: Kind;
  items: PinCandidate[] | null;
  error?: string;
  busy: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const noun = kind === "review" ? "reviews" : "shelves";
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = items?.filter((c) => !q || `${c.title} ${c.subtitle}`.toLowerCase().includes(q));
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Pick one of your {noun}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : items === null ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing left to pin. Your other published {noun} are already pinned.
        </p>
      ) : (
        <>
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search your ${noun}`}
            aria-label={`Search your ${noun}`}
          />
          {shown && shown.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No {noun} match &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
          <ul className="max-h-72 divide-y overflow-y-auto">
            {shown?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(c.id)}
                  className="hover:bg-muted flex w-full items-center gap-3 p-2 text-left disabled:opacity-50"
                >
                  <span className="bg-muted relative size-10 shrink-0 overflow-hidden rounded">
                    {c.coverUrl && (
                      <Image
                        src={c.coverUrl}
                        alt=""
                        fill
                        sizes="40px"
                        unoptimized
                        className="object-cover"
                      />
                    )}
                  </span>
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {c.subtitle}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The reviews and shelves the owner pinned. "Edit pinned" makes the cards draggable (within
 * reviews or within shelves), shows an "Add pin" slot for each free spot, and "Done" saves the order.
 */
export function PinnedEditor({
  reviews: serverReviews,
  shelves: serverShelves,
  isOwner,
  maxReviews,
  maxShelves,
}: {
  reviews: PinnedItem[];
  shelves: PinnedItem[];
  isOwner: boolean;
  maxReviews: number;
  maxShelves: number;
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState(serverReviews);
  const [shelves, setShelves] = useState(serverShelves);
  // When the server sends a different set of pins (after adding one), start from that.
  const signature = [...serverReviews, ...serverShelves].map((p) => p.id).join();
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setReviews((cur) => mergeOrder(cur, serverReviews));
    setShelves((cur) => mergeOrder(cur, serverShelves));
  }

  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState<Kind | null>(null);
  const [candidates, setCandidates] = useState<PinCandidate[] | null>(null);
  const [pickerError, setPickerError] = useState<string>();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!isOwner && reviews.length + shelves.length === 0) return null;

  const itemId = (p: PinnedItem) => p.id;
  const emptyReviewSlots = editing ? Math.max(0, maxReviews - reviews.length) : 0;
  const emptyShelfSlots = editing ? Math.max(0, maxShelves - shelves.length) : 0;

  function dragEnd(items: PinnedItem[], set: (next: PinnedItem[]) => void) {
    return ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const from = items.findIndex((i) => i.id === active.id);
      const to = items.findIndex((i) => i.id === over.id);
      if (from >= 0 && to >= 0) set(arrayMove(items, from, to));
    };
  }

  function closePicker() {
    setAdding(null);
    setCandidates(null);
    setPickerError(undefined);
  }

  function openPicker(kind: Kind) {
    if (adding === kind) return closePicker();
    setAdding(kind);
    setCandidates(null);
    setPickerError(undefined);
    startTransition(async () => {
      const res = await listPinCandidatesAction(kind);
      if (res.ok) setCandidates(res.items);
      else setPickerError(res.message);
    });
  }

  function pick(id: string) {
    if (!adding) return;
    const kind = adding;
    setPickerError(undefined);
    startTransition(async () => {
      const res = await togglePinAction(kind, id);
      if (res.ok) {
        closePicker();
        router.refresh();
      } else {
        setPickerError(res.message);
      }
    });
  }

  function done() {
    setError(undefined);
    startTransition(async () => {
      const res = await reorderPinsAction(reviews.map(itemId), shelves.map(itemId));
      if (res.ok) {
        closePicker();
        setEditing(false);
      } else setError(res.message);
    });
  }

  /** Unpins right away (it's saved on the server); Cancel doesn't bring it back. */
  function remove(kind: Kind, id: string) {
    setError(undefined);
    const setList = kind === "review" ? setReviews : setShelves;
    setList((cur) => cur.filter((p) => p.id !== id));
    setRemoved((cur) => new Set(cur).add(id));
    startTransition(async () => {
      const res = await togglePinAction(kind, id);
      if (!res.ok) {
        setError(res.message);
        setRemoved((cur) => {
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
        router.refresh();
      } else if (!res.pinned) {
        return;
      } else {
        // It was already unpinned somewhere else, so the toggle pinned it again: undo that.
        await togglePinAction(kind, id);
      }
    });
  }

  function cancel() {
    setReviews(serverReviews.filter((p) => !removed.has(p.id)));
    setShelves(serverShelves.filter((p) => !removed.has(p.id)));
    setError(undefined);
    closePicker();
    setEditing(false);
  }

  return (
    <section aria-labelledby="pinned-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="pinned-heading"
          className="flex items-center gap-1.5 text-sm font-semibold tracking-wide uppercase"
        >
          <Pin className="size-3.5" aria-hidden /> Pinned
        </h2>
        {isOwner &&
          (editing ? (
            <span className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={done} disabled={pending}>
                {pending ? "Saving…" : "Done"}
              </Button>
            </span>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit pinned
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {!editing && reviews.length + shelves.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Nothing pinned yet. Use &ldquo;Edit pinned&rdquo; to pin up to {maxReviews} reviews and{" "}
          {maxShelves} shelves.
        </p>
      )}

      {(reviews.length > 0 || emptyReviewSlots > 0) && (
        <DndContext
          id="pinned-reviews-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={dragEnd(reviews, setReviews)}
        >
          <SortableContext items={reviews.map(itemId)} strategy={rectSortingStrategy}>
            <ul className="grid gap-4 sm:grid-cols-3">
              {reviews.map((p) => (
                <Card
                  key={p.id}
                  id={p.id}
                  editing={editing}
                  href={p.href}
                  label={p.label}
                  onRemove={() => remove("review", p.id)}
                >
                  {p.body}
                </Card>
              ))}
              {Array.from({ length: emptyReviewSlots }, (_, i) => (
                <EmptySlot
                  key={`empty-review-${i}`}
                  kind="review"
                  active={adding === "review"}
                  onClick={() => openPicker("review")}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {adding === "review" && (
        <Picker
          kind="review"
          items={candidates}
          error={pickerError}
          busy={pending}
          onPick={pick}
          onClose={closePicker}
        />
      )}

      {(shelves.length > 0 || emptyShelfSlots > 0) && (
        <DndContext
          id="pinned-shelves-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={dragEnd(shelves, setShelves)}
        >
          <SortableContext items={shelves.map(itemId)} strategy={rectSortingStrategy}>
            <ul className="grid gap-4 sm:grid-cols-2">
              {shelves.map((p) => (
                <Card
                  key={p.id}
                  id={p.id}
                  editing={editing}
                  href={p.href}
                  label={p.label}
                  onRemove={() => remove("shelf", p.id)}
                >
                  {p.body}
                </Card>
              ))}
              {Array.from({ length: emptyShelfSlots }, (_, i) => (
                <EmptySlot
                  key={`empty-shelf-${i}`}
                  kind="shelf"
                  active={adding === "shelf"}
                  onClick={() => openPicker("shelf")}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {adding === "shelf" && (
        <Picker
          kind="shelf"
          items={candidates}
          error={pickerError}
          busy={pending}
          onPick={pick}
          onClose={closePicker}
        />
      )}
    </section>
  );
}
