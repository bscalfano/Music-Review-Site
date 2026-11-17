import Link from "next/link";
import { ClearButton, BulkBar, UploadForm } from "@/components/admin/import-controls";
import { ImportItem } from "@/components/admin/import-item";
import { requireOwner } from "@/lib/auth/session";
import { importCounts, listItems } from "@/lib/import/service";

const PAGE_SIZE = 25;
type Status = "pending" | "skipped" | "imported";
const STATUSES: Status[] = ["pending", "skipped", "imported"];
const LABELS: Record<Status, string> = {
  pending: "To review",
  skipped: "Skipped",
  imported: "Imported",
};

type Props = { searchParams: Promise<{ status?: string; page?: string }> };

/** Owner-only: bring in the Instagram back catalog (S3). */
export default async function ImportPage({ searchParams }: Props) {
  const owner = await requireOwner();
  const sp = await searchParams;
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : "pending";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [counts, items] = await Promise.all([
    importCounts(owner.id),
    listItems(owner.id, status, PAGE_SIZE, (page - 1) * PAGE_SIZE),
  ]);
  const total = counts[status];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section aria-labelledby="import-heading" className="space-y-6">
      <div>
        <h2 id="import-heading" className="text-lg font-semibold">
          Instagram import
        </h2>
        <ol className="text-muted-foreground mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>
            On Instagram: Settings → Accounts Center → Your information and permissions → Export
            your information. Choose <em>JSON</em> format and include Content.
          </li>
          <li>
            Unzip it and find <code>posts_1.json</code> (under{" "}
            <code>your_instagram_activity/media</code>).
          </li>
          <li>
            Upload it here (up to 4 MB) or run{" "}
            <code>pnpm import:instagram path/to/posts_1.json</code>.
          </li>
          <li>
            For each post, confirm the album, tidy the text, then publish. Reviews keep your
            original post date. Nothing goes public until you publish it.
          </li>
        </ol>
      </div>

      <UploadForm />

      <nav
        aria-label="Import status"
        className="flex flex-wrap items-center gap-4 border-b text-sm"
      >
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/import?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent pb-2 aria-[current=page]:border-current"
          >
            {LABELS[s]} ({counts[s]})
          </Link>
        ))}
        <span className="ml-auto pb-2">
          <ClearButton />
        </span>
      </nav>

      <BulkBar
        mode={status}
        allIds={items.map((i) => i.id)}
        readyIds={items.filter((i) => i.albumMbid).map((i) => i.id)}
      />

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : status === "imported" ? (
        <ul className="divide-y rounded-lg border text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3 px-3 py-2">
              <span className="truncate">{i.caption.split("\n")[0] || "(no caption)"}</span>
              <time className="text-muted-foreground shrink-0" dateTime={i.postedAt.toISOString()}>
                {i.postedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-4">
          {items.map((i) => (
            <ImportItem
              key={`${i.id}-${i.matches.length}-${i.albumMbid ?? ""}`}
              item={{
                id: i.id,
                caption: i.caption,
                postedAt: i.postedAt.toISOString(),
                title: i.title,
                body: i.body,
                rating: i.rating,
                tags: i.tags,
                albumMbid: i.albumMbid,
                matches: i.matches,
                error: i.error,
              }}
            />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <p className="flex items-center gap-4 text-sm">
          {page > 1 && (
            <Link href={`/admin/import?status=${status}&page=${page - 1}`}>← Previous</Link>
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={`/admin/import?status=${status}&page=${page + 1}`}>Next →</Link>
          )}
        </p>
      )}
    </section>
  );
}
