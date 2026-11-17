import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { reviews } from "./content";
import { users } from "./users";

/** An album suggestion for an imported post, as stored in `import_items.matches`. */
export type ImportMatch = {
  mbid: string;
  title: string;
  artist: string;
  releaseDate: string | null;
};

/**
 * Staging area for the owner's Instagram import (S3). Each row is one Instagram post waiting to
 * be matched to an album and published as a review. Nothing here is public.
 */
export const importItems = pgTable(
  "import_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Hash of timestamp + caption: re-uploading the same export adds nothing twice. */
    sourceKey: text().notNull(),
    caption: text().notNull(),
    postedAt: timestamp({ withTimezone: true }).notNull(),
    imagePath: text(),
    /** What the owner has settled on (pre-filled from the caption guess). */
    title: text(),
    body: text().notNull().default(""),
    rating: smallint(),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    albumMbid: uuid(),
    /** Suggestions from searching local data + MusicBrainz. */
    matches: jsonb()
      .$type<ImportMatch[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text().$type<"pending" | "skipped" | "imported">().notNull().default("pending"),
    reviewId: uuid().references(() => reviews.id, { onDelete: "set null" }),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("import_items_owner_source_key").on(t.ownerId, t.sourceKey),
    index("import_items_owner_status_idx").on(t.ownerId, t.status, t.postedAt),
    check("import_items_rating_range", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 0 AND 10`),
    check("import_items_status", sql`${t.status} IN ('pending', 'skipped', 'imported')`),
  ],
);
