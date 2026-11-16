import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const artists = pgTable(
  "artists",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** MusicBrainz artist ID. */
    mbid: uuid().notNull().unique(),
    name: text().notNull(),
    sortName: text(),
    slug: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artists_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`)],
);

export const albums = pgTable(
  "albums",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** MusicBrainz release-group ID: the identity of an album across the whole site. */
    mbid: uuid().notNull().unique(),
    title: text().notNull(),
    /** Not unique: URLs are /albums/[slug]-[mbid]. */
    slug: text().notNull(),
    artistId: uuid()
      .notNull()
      .references(() => artists.id),
    /** MusicBrainz dates are partial ("1997", "1997-05"), so this is text. */
    releaseDate: text(),
    primaryType: text(),
    /** R2 object key of the cached cover; null until the enrichment job runs. */
    coverKey: text(),
    genres: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    spotifyId: text(),
    appleMusicId: text(),
    deezerId: text(),
    youtubeMusicId: text(),
    tidalId: text(),
    linksResolvedAt: timestamp({ withTimezone: true }),
    /** Set when the background enrichment job (tracks, genres, cover) has completed. */
    enrichedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("albums_artist_idx").on(t.artistId),
    index("albums_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

export const tracks = pgTable(
  "tracks",
  {
    id: uuid().primaryKey().defaultRandom(),
    albumId: uuid()
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    /** MusicBrainz recording ID. */
    mbid: uuid(),
    title: text().notNull(),
    /** Overall position across discs, starting at 1. */
    position: smallint().notNull(),
    discNumber: smallint().notNull().default(1),
    durationMs: integer(),
    previewUrl: text(),
    previewSource: text(),
    previewCheckedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("tracks_album_position_key").on(t.albumId, t.position)],
);

/** Denormalized per-album counters, updated in the same transaction as review/favorite writes. */
export const albumStats = pgTable("album_stats", {
  albumId: uuid()
    .primaryKey()
    .references(() => albums.id, { onDelete: "cascade" }),
  ratingCount: integer().notNull().default(0),
  /** Sum of ratings in half-star units (0-10). Average stars = ratingSum / ratingCount / 2. */
  ratingSum: integer().notNull().default(0),
  /** 11 buckets: index i = rating of i half-stars (0 stars ... 5 stars). */
  histogram: integer()
    .array()
    .notNull()
    .default(sql`ARRAY[0,0,0,0,0,0,0,0,0,0,0]::integer[]`),
  logCount: integer().notNull().default(0),
  /** Logs that have a written body. */
  reviewCount: integer().notNull().default(0),
  /** Users with this album in their Four Favorites. */
  fanCount: integer().notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
