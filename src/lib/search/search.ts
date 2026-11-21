import { and, desc, ilike, isNotNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { searchAlbumsLocal, type AlbumHit } from "@/lib/albums/search";
import { getSearchReviews, type FeedItem } from "@/lib/social/feed";
import { blockedByViewer, profileVisibleTo, type Viewer } from "@/lib/social/visibility";

const { artists, users } = schema;

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;

/** Trims and bounds a search string; returns "" when too short to search. */
export function cleanQuery(raw: unknown): string {
  const q = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY) : "";
  return q.length >= MIN_QUERY ? q : "";
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export type ArtistHit = { id: string; slug: string; name: string; albumCount: number };
export type PersonHit = {
  id: string;
  handle: string;
  displayName: string | null;
  image: string | null;
  isPrivate: boolean;
  /** The signed-in viewer has blocked this person. */
  blocked: boolean;
};

export type SearchResults = {
  query: string;
  albums: AlbumHit[];
  artists: ArtistHit[];
  people: PersonHit[];
  reviews: FeedItem[];
};

async function searchArtists(q: string, limit: number): Promise<ArtistHit[]> {
  const like = `%${escapeLike(q)}%`;
  const rows = await getDb()
    .select({
      id: artists.id,
      slug: artists.slug,
      name: artists.name,
      // Single-table query: drizzle would print ${artists.id} unqualified, which would then
      // resolve to the subquery's own albums.id, so the table name is written out.
      albumCount: sql<number>`(SELECT count(*)::int FROM albums a WHERE a.artist_id = artists.id)`,
    })
    .from(artists)
    .where(or(ilike(artists.name, like), sql`${artists.name} % ${q}`))
    .orderBy(desc(sql`similarity(${artists.name}, ${q})`))
    .limit(limit);
  return rows;
}

async function searchPeople(q: string, viewer: Viewer, limit: number): Promise<PersonHit[]> {
  const like = `%${escapeLike(q.replace(/^@/, ""))}%`;
  const needle = q.replace(/^@/, "");
  const rows = await getDb()
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      image: users.image,
      isPrivate: users.isPrivate,
      blocked: sql<boolean>`${blockedByViewer(viewer, users)}`,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.handle),
        or(profileVisibleTo(viewer, users), blockedByViewer(viewer, users)),
        or(
          ilike(users.handle, like),
          ilike(users.displayName, like),
          sql`${users.handle} % ${needle}`,
          sql`${users.displayName} % ${needle}`,
        ),
      ),
    )
    .orderBy(
      desc(
        sql`greatest(similarity(${users.handle}, ${needle}), similarity(coalesce(${users.displayName}, ''), ${needle}))`,
      ),
    )
    .limit(limit);
  return rows.map((r) => ({ ...r, handle: r.handle! }));
}

/**
 * S9: one search box for everything, grouped by type. Every group goes through the same
 * visibility rules as the rest of the site, so blocked, suspended, deleted and private-to-you
 * content never shows up here.
 */
export async function searchSite(
  rawQuery: string,
  viewer: Viewer,
  opts: { limit?: number } = {},
): Promise<SearchResults> {
  const q = cleanQuery(rawQuery);
  const limit = opts.limit ?? 8;
  if (!q) return { query: "", albums: [], artists: [], people: [], reviews: [] };
  const [albumHits, artistHits, people, reviews] = await Promise.all([
    searchAlbumsLocal(q, limit),
    searchArtists(q, limit),
    searchPeople(q, viewer, limit),
    getSearchReviews(viewer, q, limit),
  ]);
  return { query: q, albums: albumHits, artists: artistHits, people, reviews };
}
