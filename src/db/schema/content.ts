import { desc, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { queueStatus, reactionTarget, reviewStatus } from "./enums";
import { albums, tracks } from "./music";
import { users } from "./users";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * One row per (author, album): a rating-only "log" (S23) and a full review are the same row;
 * a log simply has an empty body. Soft-deleted rows don't count toward uniqueness.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid().primaryKey().defaultRandom(),
    albumId: uuid()
      .notNull()
      .references(() => albums.id),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    title: text(),
    /** Markdown. May be empty for rating-only logs. */
    body: text().notNull().default(""),
    /**
     * Half-star units: 0 = zero stars, 1 = half a star ... 10 = five stars.
     * NULL = no rating (distinct from 0).
     */
    rating: smallint(),
    clipTrackId: uuid().references(() => tracks.id, { onDelete: "set null" }),
    status: reviewStatus().notNull().default("draft"),
    publishedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    importedFrom: text(),
    deletedAt: timestamp({ withTimezone: true }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))`,
    ),
  },
  (t) => [
    check("reviews_rating_range", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 0 AND 10`),
    uniqueIndex("reviews_author_album_key")
      .on(t.authorId, t.albumId)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex("reviews_author_slug_key")
      .on(t.authorId, t.slug)
      .where(sql`${t.deletedAt} IS NULL`),
    index("reviews_author_published_idx").on(t.authorId, desc(t.publishedAt)),
    index("reviews_album_published_idx").on(t.albumId, desc(t.publishedAt)),
    index("reviews_album_author_idx").on(t.albumId, t.authorId),
    index("reviews_search_idx").using("gin", t.searchVector),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull().unique(),
  },
  (t) => [check("tags_name_lowercase", sql`${t.name} = lower(${t.name})`)],
);

export const reviewTags = pgTable(
  "review_tags",
  {
    reviewId: uuid()
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.tagId] }), index("review_tags_tag_idx").on(t.tagId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    reviewId: uuid()
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** One level of replies: parent must itself be a top-level comment (enforced in code). */
    parentId: uuid(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("comments_review_created_idx").on(t.reviewId, t.createdAt),
    index("comments_parent_idx").on(t.parentId),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: reactionTarget().notNull(),
    targetId: uuid().notNull(),
    kind: text().notNull().default("heart"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reactions_unique_key").on(t.userId, t.targetType, t.targetId, t.kind),
    index("reactions_target_idx").on(t.targetType, t.targetId),
  ],
);

export const lists = pgTable(
  "lists",
  {
    id: uuid().primaryKey().defaultRandom(),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull(),
    slug: text().notNull(),
    description: text(),
    ranked: boolean().notNull().default(false),
    year: smallint(),
    status: reviewStatus().notNull().default("draft"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lists_author_slug_key").on(t.authorId, t.slug)],
);

export const listItems = pgTable(
  "list_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    listId: uuid()
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    albumId: uuid()
      .notNull()
      .references(() => albums.id),
    reviewId: uuid().references(() => reviews.id, { onDelete: "set null" }),
    note: text(),
  },
  (t) => [index("list_items_list_position_idx").on(t.listId, t.position)],
);

export const queueItems = pgTable(
  "queue_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    albumId: uuid()
      .notNull()
      .references(() => albums.id),
    suggestedById: uuid().references(() => users.id, { onDelete: "set null" }),
    note: text(),
    status: queueStatus().notNull().default("queued"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("queue_items_album_owner_idx").on(t.albumId, t.ownerId),
    uniqueIndex("queue_items_owner_album_queued_key")
      .on(t.ownerId, t.albumId)
      .where(sql`${t.status} = 'queued'`),
  ],
);
