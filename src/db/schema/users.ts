import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userRole, userStatus } from "./enums";

/**
 * `handle` and `displayName` are nullable because Auth.js creates the row at first sign-in,
 * before the user has chosen a handle (onboarding step in Phase 2).
 */
export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    handle: text(),
    displayName: text(),
    email: text().notNull().unique(),
    emailVerified: timestamp({ withTimezone: true }),
    /** Avatar: an R2 key, or the Google picture URL until the user uploads one. */
    image: text(),
    bio: text(),
    role: userRole().notNull().default("member"),
    status: userStatus().notNull().default("active"),
    isPrivate: boolean().notNull().default(false),
    /** Notification types that also send an email. Off by default except comments and replies. */
    emailNotifications: text()
      .array()
      .notNull()
      .default(sql`ARRAY['comment','reply']::text[]`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_handle_key").on(t.handle),
    check("users_handle_lowercase", sql`${t.handle} = lower(${t.handle})`),
    index("users_handle_trgm").using("gin", sql`${t.handle} gin_trgm_ops`),
    index("users_display_name_trgm").using("gin", sql`${t.displayName} gin_trgm_ops`),
  ],
);

// --- Auth.js tables. Property names must match what @auth/drizzle-adapter expects. ---

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);
