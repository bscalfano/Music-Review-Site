import Link from "next/link";
import { FollowButton } from "@/components/social/follow-button";
import { UserAvatar } from "@/components/user-avatar";
import type { FollowState } from "@/lib/social/visibility";

export type PersonItem = {
  id: string;
  handle: string;
  displayName: string | null;
  image: string | null;
  bio?: string | null;
  isPrivate?: boolean;
  viewerFollow: FollowState;
};

/** Rows of people with a follow button. `viewerId` null = signed out (no buttons). */
export function PeopleList({
  people,
  viewerId,
}: {
  people: PersonItem[];
  viewerId: string | null;
}) {
  return (
    <ul className="divide-y">
      {people.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-3">
          <Link
            href={`/u/${p.handle}`}
            className="shrink-0"
            aria-label={`${p.displayName ?? p.handle}'s profile`}
          >
            <UserAvatar user={p} size={44} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={`/u/${p.handle}`}
              className="block truncate text-sm font-semibold hover:underline"
            >
              {p.displayName ?? p.handle}
            </Link>
            <p className="text-muted-foreground truncate text-xs">@{p.handle}</p>
            {p.bio && <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">{p.bio}</p>}
          </div>
          {viewerId && viewerId !== p.id && (
            <FollowButton targetId={p.id} initial={p.viewerFollow} isPrivate={!!p.isPrivate} />
          )}
        </li>
      ))}
    </ul>
  );
}
