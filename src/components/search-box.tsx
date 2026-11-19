import { Search } from "lucide-react";

/** A plain GET form to /search, so it works without JavaScript. */
export function SearchBox({
  defaultValue = "",
  autoFocus = false,
  compact = false,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  return (
    <form action="/search" method="get" role="search" className="relative w-full">
      <label htmlFor={compact ? "q-header" : "q-page"} className="sr-only">
        Search albums, artists, people and reviews
      </label>
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <input
        id={compact ? "q-header" : "q-page"}
        name="q"
        type="search"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        maxLength={100}
        placeholder="Search"
        className={`border-input bg-background w-full rounded-lg border pl-8 shadow-xs ${compact ? "h-8 text-sm" : "h-10"}`}
      />
    </form>
  );
}
