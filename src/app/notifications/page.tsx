import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { RequestActions } from "@/components/social/request-actions";
import { UserAvatar } from "@/components/user-avatar";
import { requireUser } from "@/lib/auth/session";
import { listPendingRequests } from "@/lib/social/follows";
import {
  listNotifications,
  markAllRead,
  type NotificationItem,
  type NotificationType,
} from "@/lib/social/notifications";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };

const TEXT: Record<NotificationType, (subject: string | null) => string> = {
  follow: () => "started following you",
  follow_request: () => "asked to follow you",
  follow_accepted: () => "accepted your follow request",
  comment: (s) => `commented on your review${s ? ` of ${s}` : ""}`,
  reply: () => "replied to your comment",
  reaction: (s) => `liked your ${s ? `review of ${s}` : "post"}`,
  suggestion: () => "suggested an album for your queue",
};

function when(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / 60 / 24)}d`;
  return date.toLocaleDateString("en-US", { dateStyle: "medium" });
}

type Props = { searchParams: Promise<{ before?: string }> };

export default async function NotificationsPage({ searchParams }: Props) {
  const user = await requireUser({ returnTo: "/notifications" });
  const { before } = await searchParams;
  const cursor = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined;

  const [requests, { items, nextCursor }] = await Promise.all([
    cursor ? Promise.resolve([]) : listPendingRequests(user.id),
    listNotifications(user.id, cursor),
  ]);
  // Opening the page counts as reading everything on it (the bell clears on the next load).
  after(() => markAllRead(user.id));

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-bold">Notifications</h1>

      {requests.length > 0 && (
        <section aria-labelledby="requests-heading" className="mt-6">
          <h2 id="requests-heading" className="text-sm font-semibold tracking-wide uppercase">
            Follow requests
          </h2>
          <ul className="divide-y">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <Link href={`/u/${r.handle}`} className="shrink-0">
                  <UserAvatar user={r} size={44} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/u/${r.handle}`}
                    className="block truncate text-sm font-semibold hover:underline"
                  >
                    {r.displayName ?? r.handle}
                  </Link>
                  <p className="text-muted-foreground truncate text-xs">@{r.handle}</p>
                </div>
                <RequestActions followerId={r.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Activity" className="mt-6">
        {items.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            Nothing here yet. Likes, comments and new followers show up here.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </ul>
        )}
        {nextCursor && (
          <div className="pt-4 text-center">
            <Link
              href={`/notifications?before=${encodeURIComponent(nextCursor.toISOString())}`}
              className="text-sm underline underline-offset-4"
            >
              Older →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

function NotificationRow({ n }: { n: NotificationItem }) {
  const name = n.actor.displayName ?? `@${n.actor.handle}`;
  return (
    <li
      className={cn("flex items-center gap-3 py-3", !n.read && "bg-muted/50 -mx-2 rounded-lg px-2")}
    >
      <UserAvatar user={n.actor} size={36} />
      <Link href={n.href} className="min-w-0 flex-1 text-sm hover:underline">
        <span className="font-semibold">{name}</span> {TEXT[n.type](n.subject)}
      </Link>
      <time dateTime={n.createdAt.toISOString()} className="text-muted-foreground text-xs">
        {when(n.createdAt)}
      </time>
    </li>
  );
}
