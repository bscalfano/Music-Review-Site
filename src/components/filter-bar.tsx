import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import {
  filtersToQuery,
  hasActiveFilters,
  SORT_LABELS,
  SORTS,
  type Filters,
} from "@/lib/discovery/filters";
import { cn } from "@/lib/utils";

const STAR_STEPS = Array.from({ length: 11 }, (_, i) => i / 2); // 0, 0.5 ... 5

const selectClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-sm shadow-xs";

/**
 * Sort and filter controls (S8). A plain GET form, so it works without JavaScript and every
 * state is a shareable URL. Active filters show as chips that each remove themselves.
 */
export function FilterBar({
  basePath,
  filters,
  /** Params to carry through unchanged (none today, kept for pages that add their own). */
  keep = {},
}: {
  basePath: string;
  filters: Filters;
  keep?: Record<string, string>;
}) {
  const without = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    for (const k of Object.keys(patch) as (keyof Filters)[]) {
      if (patch[k] === undefined) delete next[k];
    }
    const q = filtersToQuery(next, keep);
    return q ? `${basePath}?${q}` : basePath;
  };

  const chips: { label: string; href: string }[] = [];
  if (filters.genre) {
    chips.push({ label: `Genre: ${filters.genre}`, href: without({ genre: undefined }) });
  }
  if (filters.tag) chips.push({ label: `Tag: ${filters.tag}`, href: without({ tag: undefined }) });
  if (filters.yearFrom || filters.yearTo) {
    chips.push({
      label: `Released ${filters.yearFrom ?? "…"}–${filters.yearTo ?? "…"}`,
      href: without({ yearFrom: undefined, yearTo: undefined }),
    });
  }
  if (filters.ratingMin !== undefined || filters.ratingMax !== undefined) {
    chips.push({
      label: `Rated ${(filters.ratingMin ?? 0) / 2}–${(filters.ratingMax ?? 10) / 2} ★`,
      href: without({ ratingMin: undefined, ratingMax: undefined }),
    });
  }
  const active = hasActiveFilters(filters);

  return (
    <div className="space-y-2">
      <details open={active} className="group rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
          Sort and filter
          {filters.sort !== "recent" && (
            <span className="text-muted-foreground font-normal">
              {" "}
              · {SORT_LABELS[filters.sort]}
            </span>
          )}
        </summary>
        <form
          action={basePath}
          method="get"
          className="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <div className="space-y-1">
            <Label htmlFor="f-sort">Sort by</Label>
            <select id="f-sort" name="sort" defaultValue={filters.sort} className={selectClass}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-genre">Genre</Label>
            <Input
              id="f-genre"
              name="genre"
              defaultValue={filters.genre ?? ""}
              placeholder="e.g. post-punk"
              maxLength={40}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-tag">Tag</Label>
            <Input
              id="f-tag"
              name="tag"
              defaultValue={filters.tag ?? ""}
              placeholder="e.g. favorites"
              maxLength={40}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="f-from">Released from</Label>
              <Input
                id="f-from"
                name="from"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                defaultValue={filters.yearFrom ?? ""}
                placeholder="1990"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-to">to</Label>
              <Input
                id="f-to"
                name="to"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                defaultValue={filters.yearTo ?? ""}
                placeholder="1999"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="f-min">Stars from</Label>
              <select
                id="f-min"
                name="min"
                defaultValue={filters.ratingMin !== undefined ? String(filters.ratingMin / 2) : ""}
                className={selectClass}
              >
                <option value="">Any</option>
                {STAR_STEPS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-max">to</Label>
              <select
                id="f-max"
                name="max"
                defaultValue={filters.ratingMax !== undefined ? String(filters.ratingMax / 2) : ""}
                className={selectClass}
              >
                <option value="">Any</option>
                {STAR_STEPS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
            <button type="submit" className={cn(buttonVariants())}>
              Apply
            </button>
            {active && (
              <Link
                href={
                  Object.keys(keep).length ? `${basePath}?${new URLSearchParams(keep)}` : basePath
                }
                className={buttonVariants({ variant: "ghost" })}
              >
                Clear
              </Link>
            )}
          </div>
        </form>
      </details>

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.label}>
              <Link
                href={c.href}
                className="bg-muted hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs"
                aria-label={`Remove filter: ${c.label}`}
              >
                {c.label} <span aria-hidden>×</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
