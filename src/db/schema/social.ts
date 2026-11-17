import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  followStatus,
  notificationTarget,
  notificationType,
  reportStatus,
  reportTarget,
} from "./enums";
import { users } from "./users";

export const follows = pgTable(
  "follows",
  {
    followerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 'pending' only when the followee is a private account. */
    status: followStatus().notNull().default("accepted"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee_status_idx").on(t.followeeId, t.status),
    check("follows_not_self", sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("blocks_blocked_idx").on(t.blockedId),
    check("blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    recipientId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType().notNull(),
    targetType: notificationTarget().notNull(),
    targetId: uuid().notNull(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_recipient_created_idx").on(t.recipientId, desc(t.createdAt)),
    // The same actor doing the same thing to the same target notifies once (no like/unlike spam).
    uniqueIndex("notifications_dedupe_key").on(
      t.recipientId,
      t.actorId,
      t.type,
      t.targetType,
      t.targetId,
    ),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    reporterId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: reportTarget().notNull(),
    targetId: uuid().notNull(),
    /** A category slug (see lib/moderation/reasons.ts). */
    reason: text().notNull(),
    details: text(),
    status: reportStatus().notNull().default("open"),
    resolvedById: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("reports_status_created_idx").on(t.status, t.createdAt),
    index("reports_target_idx").on(t.targetType, t.targetId),
    // One open report per person per target: reporting twice doesn't flood the queue.
    uniqueIndex("reports_open_unique")
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`${t.status} = 'open'`),
  ],
);

/** Everything admins do to other people's content or accounts, for accountability. */
export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid().primaryKey().defaultRandom(),
    adminId: uuid().references(() => users.id, { onDelete: "set null" }),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: uuid().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_actions_created_idx").on(desc(t.createdAt))],
);
