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
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import Image from "next/image";
import { useState, useTransition } from "react";
import { saveFavorites, type AlbumHitDto } from "@/app/settings/actions";
import { AlbumPicker } from "@/components/album-picker";
import { Button } from "@/components/ui/button";

function Tile({
  item,
  index,
  count,
  onMove,
  onRemove,
}: {
  item: AlbumHitDto;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.mbid,
  });
  const small =
    "flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black disabled:opacity-30";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative aspect-square touch-none overflow-hidden rounded-md shadow-sm ${isDragging ? "ring-ring z-10 ring-2" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`${item.title} by ${item.artistName}, position ${index + 1} of ${count}. Drag to reorder.`}
        className="focus-visible:ring-ring absolute inset-0 cursor-grab outline-none focus-visible:ring-3 active:cursor-grabbing"
      >
        <Image
          src={item.coverUrl}
          alt=""
          fill
          sizes="160px"
          unoptimized
          className="bg-muted object-cover"
        />
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6 text-white">
        <p className="truncate text-xs font-semibold">{item.title}</p>
        <p className="truncate text-[11px] text-white/80">{item.artistName}</p>
      </div>
      <div className="absolute inset-x-1 top-1 flex justify-between">
        <span className="flex gap-1">
          <button
            type="button"
            className={small}
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={`Move ${item.title} earlier`}
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <button
            type="button"
            className={small}
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={`Move ${item.title} later`}
          >
            <ArrowRight className="size-3.5" />
          </button>
        </span>
        <button
          type="button"
          className={small}
          onClick={() => onRemove(index)}
          aria-label={`Remove ${item.title}`}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

export function FavoritesEditor({ initial }: { initial: AlbumHitDto[] }) {
  const [items, setItems] = useState(initial);
  const [saved, setSaved] = useState(initial.map((i) => i.mbid));
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const [pending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dirty = items.map((i) => i.mbid).join() !== saved.join();
  const move = (from: number, to: number) => setItems((cur) => arrayMove(cur, from, to));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setItems((cur) =>
      arrayMove(
        cur,
        cur.findIndex((i) => i.mbid === active.id),
        cur.findIndex((i) => i.mbid === over.id),
      ),
    );
  };

  const save = () =>
    startTransition(async () => {
      const mbids = items.map((i) => i.mbid);
      const res = await saveFavorites(mbids);
      if (res.ok) setSaved(mbids);
      setStatus({
        ok: !!res.ok,
        text: res.ok ? "Saved." : (res.errors?.favorites ?? "Couldn't save."),
      });
    });

  return (
    <div className="space-y-3">
      <DndContext
        id="favorites-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={items.map((i) => i.mbid)} strategy={rectSortingStrategy}>
          <ul className="grid grid-cols-4 gap-2 sm:gap-3">
            {items.map((item, index) => (
              <Tile
                key={item.mbid}
                item={item}
                index={index}
                count={items.length}
                onMove={move}
                onRemove={(i) => setItems((cur) => cur.filter((_, n) => n !== i))}
              />
            ))}
            {items.length < 4 && (
              <li>
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  aria-label="Add a favorite album"
                  className="text-muted-foreground hover:text-foreground flex aspect-square w-full items-center justify-center rounded-md border border-dashed transition-colors"
                >
                  <Plus />
                </button>
              </li>
            )}
          </ul>
        </SortableContext>
      </DndContext>

      {picking && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Pick an album</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(false)}>
              Close
            </Button>
          </div>
          <AlbumPicker
            autoFocus
            excludeMbids={items.map((i) => i.mbid)}
            onPick={(album) => {
              setItems((cur) => (cur.length < 4 ? [...cur, album] : cur));
              setPicking(false);
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save favorites"}
        </Button>
        {status && (
          <p
            role="status"
            className={`text-sm ${status.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {status.text}
          </p>
        )}
        {dirty && !pending && <p className="text-muted-foreground text-xs">Unsaved changes</p>}
      </div>
    </div>
  );
}
