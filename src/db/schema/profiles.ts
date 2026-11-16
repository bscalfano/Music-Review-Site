import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { albums } from "./music";
import { users } from "./users";

export type ProfileLink = { label: string; url: string };

export const profiles = pgTable("profiles", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  bannerKey: text(),
  /** Vertical focal point (0-100) used when the banner is cropped on narrow screens. */
  bannerFocalY: integer().notNull().default(50),
  pronouns: text(),
  location: text(),
  links: jsonb()
    .$type<ProfileLink[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Hex color like #ff5500, validated for contrast at save time. */
  accentColor: text(),
  themePreset: text().notNull().default("default"),
  gridShowRatings: boolean().notNull().default(true),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const favoriteAlbums = pgTable(
  "favorite_albums",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    position: smallint().notNull(),
    albumId: uuid()
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.position] }),
    uniqueIndex("favorite_albums_user_album_key").on(t.userId, t.albumId),
    check("favorite_albums_position_range", sql`${t.position} BETWEEN 1 AND 4`),
  ],
);
