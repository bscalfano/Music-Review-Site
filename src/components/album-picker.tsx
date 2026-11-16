"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { searchAlbumsAction, type AlbumHitDto } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/**
 * Search-as-you-type album chooser, shared by Four Favorites now and the review editor later.
 * Looks in our own library first; "Search all of MusicBrainz" goes to the external database.
 */
export function AlbumPicker({
  onPick,
  excludeMbids = [],
  autoFocus = false,
}: {
  onPick: (album: AlbumHitDto) => void;
  excludeMbids?: string[];
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AlbumHitDto[]>([]);
  const [error, setError] = useState<string>();
  const [searched, setSearched] = useState(false);
  const [remoteDone, setRemoteDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0); // ignore responses to stale queries

  const run = (q: string, remote: boolean) => {
    const id = ++latest.current;
    startTransition(async () => {
      const res = await searchAlbumsAction(q, remote);
      if (id !== latest.current) return;
      setResults(res.results);
      setError(res.error);
      setSearched(true);
      setRemoteDone(remote);
    });
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      latest.current++;
      setResults([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => run(q, false), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const visible = results.filter((r) => !excludeMbids.includes(r.mbid));

  return (
    <div className="space-y-2">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for an album or artist…"
        aria-label="Search for an album"
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {visible.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {visible.map((album) => (
            <li key={album.mbid}>
              <button
                type="button"
                onClick={() => onPick(album)}
                className="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-3 px-3 py-2 text-left outline-none"
              >
                <span className="bg-muted relative size-10 shrink-0 overflow-hidden rounded">
                  <Image
                    src={album.coverUrl}
                    alt=""
                    fill
                    sizes="40px"
                    unoptimized
                    className="object-cover"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{album.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {album.artistName}
                    {album.year ? ` · ${album.year}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && !pending && visible.length === 0 && !error && (
        <p className="text-muted-foreground text-xs">
          No matches{remoteDone ? "" : " in our library yet"}.
        </p>
      )}
      {query.trim().length >= 2 && !remoteDone && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(query.trim(), true)}
        >
          {pending ? "Searching…" : "Search all of MusicBrainz"}
        </Button>
      )}
    </div>
  );
}
