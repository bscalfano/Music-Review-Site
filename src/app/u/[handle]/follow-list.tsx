import { Lock } from "lucide-react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { PeopleList } from "@/components/social/people-list";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { getProfileByHandle } from "@/lib/profiles/queries";
import { listFollowers, listFollowing } from "@/lib/social/follows";
import {
  authorFacts,
  canViewContent,
  canViewProfileHeader,
  loadRelation,
} from "@/lib/social/visibility";

/** Shared body of /u/[handle]/followers and /u/[handle]/following. */
export async function FollowListPage({
  direction,
  handle,
  pageParam,
}: {
  direction: "followers" | "following";
  handle: string;
  pageParam?: string;
}) {
  if (handle !== handle.toLowerCase()) {
    permanentRedirect(`/u/${handle.toLowerCase()}/${direction}`);
  }
  const [data, current] = await Promise.all([getProfileByHandle(handle), getCurrentUser()]);
  if (!data) notFound();
  const { user } = data;
  const viewer = toViewer(current);
  const relation = await loadRelation(viewer, user.id);
  if (!canViewProfileHeader(viewer, authorFacts(user), relation)) notFound();
  const canSee = canViewContent(viewer, authorFacts(user), relation);

  const page = Math.max(1, Math.min(200, Number.parseInt(pageParam ?? "1", 10) || 1));
  const list = canSee
    ? await (direction === "followers" ? listFollowers : listFollowing)(user.id, viewer, page)
    : { items: [], hasMore: false };
  const name = user.displayName ?? `@${user.handle}`;
  const base = `/u/${user.handle}/${direction}`;

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <p className="text-muted-foreground text-sm">
        <Link href={`/u/${user.handle}`} className="hover:underline">
          ← {name}
        </Link>
      </p>
      <h1 className="mt-1 text-2xl font-bold capitalize">{direction}</h1>

      {!canSee ? (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center">
          <Lock className="text-muted-foreground size-6" aria-hidden />
          <p className="font-medium">This account is private</p>
        </div>
      ) : list.items.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {direction === "followers" ? "No followers yet." : "Not following anyone yet."}
        </p>
      ) : (
        <PeopleList people={list.items} viewerId={current?.id ?? null} />
      )}

      {(page > 1 || list.hasMore) && (
        <nav aria-label="Pages" className="flex justify-between pt-4 text-sm">
          {page > 1 ? (
            <Link href={`${base}?page=${page - 1}`} className="underline underline-offset-4">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {list.hasMore && (
            <Link href={`${base}?page=${page + 1}`} className="underline underline-offset-4">
              Older →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
