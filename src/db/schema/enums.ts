import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "admin", "member"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const followStatus = pgEnum("follow_status", ["pending", "accepted"]);
export const reviewStatus = pgEnum("review_status", ["draft", "published"]);
export const reactionTarget = pgEnum("reaction_target", ["review", "comment"]);
export const queueStatus = pgEnum("queue_status", ["queued", "reviewed", "dismissed"]);
export const notificationType = pgEnum("notification_type", [
  "follow",
  "follow_request",
  "follow_accepted",
  "comment",
  "reply",
  "reaction",
  "suggestion",
]);
export const notificationTarget = pgEnum("notification_target", [
  "user",
  "review",
  "comment",
  "album",
]);
export const reportTarget = pgEnum("report_target", ["review", "comment", "user"]);
export const reportStatus = pgEnum("report_status", ["open", "actioned", "dismissed"]);
