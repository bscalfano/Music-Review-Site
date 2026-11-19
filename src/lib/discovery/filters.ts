import { sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import { normalizeTag } from "@/lib/reviews/schema";

/**
 * Sort + filter state for review grids (S8, S4). It lives entirely in the URL query string so a
 * filtered view can be shared. Parsing is strict: anything unrecognised is dropped, never trusted.
 */
export const SORTS = ["recent", "oldest", "rating", "year"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABELS: Record<Sort, string> = {
  recent: "Newest first",
  oldest: "Oldest first",
  rating: "Highest rated",
  year: "Release year",
};

export type Filters = {
  sort: Sort;
  /** Release year range, inclusive. */
  yearFrom?: number;
  yearTo?: number;
  /** Lowercase genre name. */
  genre?: string;
  /** Normalised review tag. */
  tag?: string;
  /** Rating range in half-star units 0..10 (so 3.5 stars = 7). Unrated items never match. */
  ratingMin?: number;
  ratingMax?: number;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const year = (v: string | undefined) => {
  if (!v || !/^\d{4}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1000 && n <= 2999 ? n : undefined;
};

/** Stars ("3.5") to half-star units; null for anything that isn't a 0..5 multiple of 0.5. */
const stars = (v: string | undefined) => {
  if (!v || !/^\d(\.[05])?$/.test(v)) return undefined;
  const n = Number(v) * 2;
  return n >= 0 && n <= 10 ? n : undefined;
};

const MAX_TEXT = 40;

export function parseFilters(raw: Raw): Filters {
  const sortRaw = one(raw.sort);
  const f: Filters = { sort: SORTS.find((s) => s === sortRaw) ?? "recent" };
  f.yearFrom = year(one(raw.from));
  f.yearTo = year(one(raw.to));
  if (f.yearFrom && f.yearTo && f.yearFrom > f.yearTo)
    [f.yearFrom, f.yearTo] = [f.yearTo, f.yearFrom];
  const genre = one(raw.genre)?.trim().toLowerCase().slice(0, MAX_TEXT);
  if (genre) f.genre = genre;
  const tag = normalizeTag(one(raw.tag) ?? "");
  if (tag) f.tag = tag;
  f.ratingMin = stars(one(raw.min));
  f.ratingMax = stars(one(raw.max));
  if (f.ratingMin !== undefined && f.ratingMax !== undefined && f.ratingMin > f.ratingMax) {
    [f.ratingMin, f.ratingMax] = [f.ratingMax, f.ratingMin];
  }
  // Drop undefined keys so equality checks and serialisation stay simple.
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Filters;
}

/** True when anything beyond the default sort is set. */
export const hasActiveFilters = (f: Filters) =>
  Object.keys(f).some((k) => k !== "sort") || f.sort !== "recent";

/** The query string for these filters (no leading "?"), optionally with extra params. */
export function filtersToQuery(f: Filters, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams();
  if (f.sort !== "recent") p.set("sort", f.sort);
  if (f.yearFrom) p.set("from", String(f.yearFrom));
  if (f.yearTo) p.set("to", String(f.yearTo));
  if (f.genre) p.set("genre", f.genre);
  if (f.tag) p.set("tag", f.tag);
  if (f.ratingMin !== undefined) p.set("min", String(f.ratingMin / 2));
  if (f.ratingMax !== undefined) p.set("max", String(f.ratingMax / 2));
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

const { reviews, albums } = schema;

/**
 * SQL conditions for the filters. Needs `reviews` and `albums` in the query. Everything is a
 * bound parameter.
 */
export function filterConditions(f: Filters): SQL[] {
  const out: SQL[] = [];
  // Release dates are partial text ("1997", "1997-05"): the first four characters are the year.
  if (f.yearFrom) out.push(sql`left(${albums.releaseDate}, 4) >= ${String(f.yearFrom)}`);
  if (f.yearTo) out.push(sql`left(${albums.releaseDate}, 4) <= ${String(f.yearTo)}`);
  if (f.yearFrom || f.yearTo) out.push(sql`${albums.releaseDate} ~ '^[0-9]{4}'`);
  if (f.genre) {
    out.push(sql`EXISTS (
      SELECT 1 FROM unnest(${albums.genres}) AS g WHERE lower(g) = ${f.genre}
    )`);
  }
  if (f.tag) {
    out.push(sql`EXISTS (
      SELECT 1 FROM review_tags rt JOIN tags t ON t.id = rt.tag_id
      WHERE rt.review_id = ${reviews.id} AND t.name = ${f.tag}
    )`);
  }
  if (f.ratingMin !== undefined) out.push(sql`${reviews.rating} >= ${f.ratingMin}`);
  if (f.ratingMax !== undefined) out.push(sql`${reviews.rating} <= ${f.ratingMax}`);
  return out;
}

/** ORDER BY terms for a sort, always ending in a unique tiebreaker so paging is stable. */
export function sortOrder(sort: Sort): SQL[] {
  switch (sort) {
    case "oldest":
      return [sql`${reviews.publishedAt} ASC NULLS LAST`, sql`${reviews.id} ASC`];
    case "rating":
      return [
        sql`${reviews.rating} DESC NULLS LAST`,
        sql`${reviews.publishedAt} DESC NULLS LAST`,
        sql`${reviews.id} DESC`,
      ];
    case "year":
      return [
        sql`${albums.releaseDate} DESC NULLS LAST`,
        sql`${reviews.publishedAt} DESC NULLS LAST`,
        sql`${reviews.id} DESC`,
      ];
    default:
      return [sql`${reviews.publishedAt} DESC NULLS LAST`, sql`${reviews.id} DESC`];
  }
}
