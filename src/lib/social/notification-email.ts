import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { siteConfig } from "@/config/site";
import { listNotifications, type NotificationType } from "./notifications";

const { notifications, users } = schema;

const SENTENCE: Record<NotificationType, (name: string, subject: string | null) => string> = {
  comment: (n, s) => `${n} commented on your review${s ? ` of ${s}` : ""}.`,
  reply: (n) => `${n} replied to your comment.`,
  reaction: (n, s) => `${n} liked your ${s ? `review of ${s}` : "post"}.`,
  follow: (n) => `${n} started following you.`,
  follow_request: (n) => `${n} asked to follow you.`,
  follow_accepted: (n) => `${n} accepted your follow request.`,
  suggestion: (n) => `${n} suggested an album for your queue.`,
};

/** Plain-text email for one notification. Exported for tests. */
export function buildNotificationEmail(
  type: NotificationType,
  actorName: string,
  subject: string | null,
  url: string,
): { subject: string; text: string } {
  const sentence = SENTENCE[type](actorName, subject);
  return {
    subject: sentence,
    text: `${sentence}\n\n${url}\n\nYou can change which emails you get in Settings: ${siteConfig.url}/settings`,
  };
}

/**
 * Job handler: emails one notification if the recipient has opted in to its type. Without a
 * RESEND_API_KEY (local development) it does nothing. Safe to retry.
 */
export async function sendNotificationEmail(notificationId: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const db = getDb();
  const [row] = await db
    .select({ n: notifications, recipient: users })
    .from(notifications)
    .innerJoin(users, eq(notifications.recipientId, users.id))
    .where(eq(notifications.id, notificationId))
    .limit(1);
  if (!row) return; // retracted since the job was queued
  const { n, recipient } = row;
  if (!recipient.emailNotifications.includes(n.type)) return;
  if (recipient.status !== "active" || recipient.deletedAt) return;

  const { items } = await listNotifications(recipient.id);
  const item = items.find((i) => i.id === n.id);
  if (!item) return;

  const actorName = item.actor.displayName ?? `@${item.actor.handle}`;
  const email = buildNotificationEmail(
    n.type,
    actorName,
    item.subject,
    `${siteConfig.url}${item.href}`,
  );
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: siteConfig.emailFrom,
      to: recipient.email,
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}
