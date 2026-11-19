import Image from "next/image";
import Link from "next/link";
import {
  QueueAdder,
  RemoveFromQueueButton,
  SuggestForm,
  SuggestionActions,
} from "@/components/queue/queue-controls";
import { StatsView } from "@/components/stats/stats-view";
import { buttonVariants } from "@/components/ui/button";
import { albumPath, artistPath } from "@/lib/albums/paths";
import type { ListSummary } from "@/lib/lists/service";
import { albumCoverUrl } from "@/lib/music";
import type { QueueEntry } from "@/lib/queue/service";
import type { UserStats } from "@/lib/stats/user-stats";

export const PROFILE_TABS = ["reviews", "lists", "queue", "stats"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
const LABELS: Record<ProfileTab, string> = {
  reviews: "Reviews",
  lists: "Lists",
  queue: "Up next",
  stats: "Stats",
};

export const parseTab = (v: unknown): ProfileTab => PROFILE_TABS.find((t) => t === v) ?? "reviews";

/** Tab strip for a profile. Plain links (`?tab=`), so each tab is shareable. */
export function ProfileTabs({
  handle,
  active,
  counts,
}: {
  handle: string;
  active: ProfileTab;
  counts: Partial<Record<ProfileTab, number>>;
}) {
  return (
    <nav aria-label="Profile sections" className="flex gap-6 overflow-x-auto border-b">
      {PROFILE_TABS.map((t) => (
        <Link
          key={t}
          href={t === "reviews" ? `/u/${handle}` : `/u/${handle}?tab=${t}`}
          aria-current={t === active ? "page" : undefined}
          className="-mb-px border-b-2 border-transparent pb-2 text-sm whitespace-nowrap aria-[current=page]:border-(--profile-accent) aria-[current=page]:font-semibold"
        >
          {LABELS[t]}
          {counts[t] !== undefined && (
            <span className="text-muted-foreground font-normal"> {counts[t]}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

function Collage({ covers }: { covers: ListSummary["covers"] }) {
  return (
    <div className="bg-muted grid aspect-square grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-md">
      {[0, 1, 2, 3].map((i) => {
        const c = covers[i];
        return c ? (
          <div key={c.mbid} className="relative">
            <Image
              src={albumCoverUrl(c, 250)}
              alt=""
              fill
              sizes="120px"
              unoptimized
              className="object-cover"
            />
          </div>
        ) : (
          <div key={i} />
        );
      })}
    </div>
  );
}

export function ListsTab({
  handle,
  lists,
  isOwner,
}: {
  handle: string;
  lists: ListSummary[];
  isOwner: boolean;
}) {
  return (
    <div className="space-y-4">
      {isOwner && (
        <Link href="/write/list" className={buttonVariants({ size: "sm", variant: "outline" })}>
          New list
        </Link>
      )}
      {lists.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {isOwner ? "You haven't made any lists yet." : "No lists yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {lists.map((l) => (
            <li key={l.id} className="space-y-2">
              <Link href={`/lists/${handle}/${l.slug}`} className="block">
                <Collage covers={l.covers} />
              </Link>
              <div className="text-sm">
                <Link
                  href={`/lists/${handle}/${l.slug}`}
                  className="line-clamp-2 font-medium hover:underline"
                >
                  {l.title}
                </Link>
                <p className="text-muted-foreground text-xs">
                  {l.itemCount} {l.itemCount === 1 ? "album" : "albums"}
                  {l.year ? ` · ${l.year}` : ""}
                  {l.status === "draft" ? " · draft" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function QueueTab({
  ownerId,
  ownerName,
  queue,
  suggestions,
  isOwner,
  acceptsSuggestions,
  /** Set for signed-out visitors: where "Sign in to suggest" should go. */
  signInHref,
  canSuggest,
}: {
  ownerId: string;
  ownerName: string;
  queue: QueueEntry[];
  suggestions: QueueEntry[];
  isOwner: boolean;
  acceptsSuggestions: boolean;
  signInHref?: string;
  canSuggest: boolean;
}) {
  return (
    <div className="space-y-8">
      {isOwner && (
        <>
          <QueueAdder />
          {suggestions.length > 0 && (
            <section aria-labelledby="suggestions-heading" className="space-y-3">
              <h2
                id="suggestions-heading"
                className="text-sm font-semibold tracking-wide uppercase"
              >
                Suggestions for you{" "}
                <span className="text-muted-foreground font-normal">{suggestions.length}</span>
              </h2>
              <ul className="divide-y rounded-lg border">
                {suggestions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                    <Link href={albumPath(s.album)} className="bg-muted relative size-14 shrink-0">
                      <Image
                        src={albumCoverUrl(s.album, 250)}
                        alt=""
                        fill
                        sizes="56px"
                        unoptimized
                        className="rounded object-cover"
                      />
                    </Link>
                    <div className="min-w-0 flex-1 text-sm">
                      <Link href={albumPath(s.album)} className="font-medium hover:underline">
                        {s.album.title}
                      </Link>
                      <span className="text-muted-foreground"> · {s.artist.name}</span>
                      <p className="text-muted-foreground text-xs">
                        {s.suggestedBy ? (
                          <>
                            from{" "}
                            <Link href={`/u/${s.suggestedBy.handle}`} className="underline">
                              {s.suggestedBy.displayName ?? `@${s.suggestedBy.handle}`}
                            </Link>
                          </>
                        ) : (
                          "from someone who has since left"
                        )}
                      </p>
                      {s.note && <p className="pt-1 whitespace-pre-wrap">{s.note}</p>}
                    </div>
                    <SuggestionActions itemId={s.id} title={s.album.title} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {queue.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {isOwner ? "Nothing queued yet." : `${ownerName} has nothing queued.`}
        </p>
      ) : (
        <section aria-labelledby="up-next-heading" className="space-y-3">
          <h2 id="up-next-heading" className="sr-only">
            Up next
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {queue.map((q) => (
              <li key={q.id} className="space-y-1.5">
                <Link
                  href={albumPath(q.album)}
                  className="bg-muted relative block aspect-square overflow-hidden rounded-md"
                >
                  <Image
                    src={albumCoverUrl(q.album, 500)}
                    alt={`Album cover of ${q.album.title} by ${q.artist.name}`}
                    fill
                    sizes="(min-width: 1024px) 18vw, 45vw"
                    unoptimized
                    className="object-cover"
                  />
                </Link>
                <div className="text-sm">
                  <Link
                    href={albumPath(q.album)}
                    className="line-clamp-2 font-medium hover:underline"
                  >
                    {q.album.title}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    <Link href={artistPath(q.artist)} className="hover:underline">
                      {q.artist.name}
                    </Link>
                  </p>
                  {q.note && <p className="text-muted-foreground pt-1 text-xs">{q.note}</p>}
                  {isOwner && <RemoveFromQueueButton albumId={q.albumId} title={q.album.title} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isOwner && acceptsSuggestions && (canSuggest || signInHref) && (
        <SuggestForm ownerId={ownerId} ownerName={ownerName} signInHref={signInHref} />
      )}
      {!isOwner && !acceptsSuggestions && (
        <p className="text-muted-foreground text-sm">{ownerName} isn&apos;t taking suggestions.</p>
      )}
    </div>
  );
}

export function StatsTab({ stats, name }: { stats: UserStats; name: string }) {
  return <StatsView stats={stats} name={name} />;
}
