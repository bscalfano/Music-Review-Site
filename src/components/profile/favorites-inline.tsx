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
import { Plus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { saveFavorites, type AlbumHitDto } from "@/app/settings/actions";
import { AlbumPicker } from "@/components/album-picker";
import { Button } from "@/components/ui/button";

const MAX_FAVORITES = 4;

/** One favorite; `body` is the cover (and hover caption), drawn on the server or, when just picked, here. */
export type FavoriteCard = { mbid: string; label: string; href: string; body: ReactNode };

function fromPick(album: AlbumHitDto): FavoriteCard {
  return {
    mbid: album.mbid,
    label: album.title,
    href: `/albums/${album.mbid}`,
    body: (
      <>
        <Image
          src={album.coverUrl}
          alt={`Album cover of ${album.title} by ${album.artistName}`}
          fill
          sizes="160px"
          unoptimized
          className="bg-muted object-cover"
        />
        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/85 to-transparent p-2 text-white">
          <span className="truncate text-xs font-semibold">{album.title}</span>
          <span className="truncate text-[11px] text-white/80">{album.artistName}</span>
        </span>
      </>
    ),
  };
}

function Tile({
  card,
  editing,
  onRemove,
}: {
  card: FavoriteCard;
  editing: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.mbid,
    disabled: !editing,
  });
  const frame = "relative block aspect-square overflow-hidden rounded-md shadow-sm";
  if (!editing) {
    return (
      <li>
        <Link
          href={card.href}
          className={`group focus-visible:ring-ring outline-none focus-visible:ring-3 ${frame}`}
        >
          {card.body}
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
      className={`${frame} cursor-grab touch-none select-none active:cursor-grabbing ${isDragging ? "ring-ring z-10 shadow-lg ring-2" : ""}`}
    >
      <div className="pointer-events-none absolute inset-0">{card.body}</div>
      <button
        type="button"
        aria-label={`Remove ${card.label} from your favorites`}
        title="Remove from favorites"
        // Keep the click from starting a drag of the tile underneath.
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/**
 * The profile's Four Favorites. For the owner, "Edit favorites" makes the tiles draggable, adds an
 * x on each, and shows an "Add" slot for every free spot (opening an inline album search). Nothing
 * is saved until "Done"; "Cancel" puts everything back.
 */
export function FavoritesInline({
  cards: serverCards,
  isOwner,
}: {
  cards: FavoriteCard[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(serverCards);
  // After a save the server sends the new list; start from that.
  const signature = serverCards.map((c) => c.mbid).join();
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setCards(serverCards);
  }

  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const emptySlots = isOwner ? MAX_FAVORITES - cards.length : 0;

  function startEditing(openPicker: boolean) {
    setEditing(true);
    setPicking(openPicker);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = cards.findIndex((c) => c.mbid === active.id);
    const to = cards.findIndex((c) => c.mbid === over.id);
    if (from >= 0 && to >= 0) setCards(arrayMove(cards, from, to));
  }

  function done() {
    setError(undefined);
    startTransition(async () => {
      const res = await saveFavorites(cards.map((c) => c.mbid));
      if (res.ok) {
        setEditing(false);
        setPicking(false);
        router.refresh();
      } else {
        setError(res.errors?.favorites ?? "Couldn't save your favorites.");
      }
    });
  }

  function cancel() {
    setCards(serverCards);
    setError(undefined);
    setPicking(false);
    setEditing(false);
  }

  return (
    <section aria-labelledby="favorites-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-3 border-b pb-1">
        <h2
          id="favorites-heading"
          className="text-muted-foreground text-xs font-semibold tracking-widest"
        >
          FAVORITE ALBUMS
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
            <Button type="button" variant="outline" size="sm" onClick={() => startEditing(false)}>
              Edit favorites
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <DndContext
        id="favorites-inline-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={cards.map((c) => c.mbid)} strategy={rectSortingStrategy}>
          <ul className="grid grid-cols-4 gap-2 sm:gap-3">
            {cards.map((card) => (
              <Tile
                key={card.mbid}
                card={card}
                editing={editing}
                onRemove={() => setCards((cur) => cur.filter((c) => c.mbid !== card.mbid))}
              />
            ))}
            {Array.from({ length: emptySlots }, (_, i) => (
              <li key={`empty-${i}`}>
                <button
                  type="button"
                  aria-label="Add favorite album"
                  aria-expanded={editing && picking}
                  onClick={() => (editing ? setPicking((p) => !p) : startEditing(true))}
                  className={`text-muted-foreground hover:text-foreground flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border-dashed text-xs transition-colors sm:text-sm ${editing ? "border-2" : "hover:border-foreground/40 border"} ${editing && picking ? "border-ring text-foreground" : ""}`}
                >
                  <Plus className={editing ? "size-5" : undefined} aria-hidden />
                  {editing && "Add favorite"}
                </button>
              </li>
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {editing && picking && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Pick an album</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPicking(false)}>
              Close
            </Button>
          </div>
          <AlbumPicker
            autoFocus
            excludeMbids={cards.map((c) => c.mbid)}
            onPick={(album) => {
              setCards((cur) => (cur.length < MAX_FAVORITES ? [...cur, fromPick(album)] : cur));
              setPicking(false);
            }}
          />
        </div>
      )}
    </section>
  );
}
