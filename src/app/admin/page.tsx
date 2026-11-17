import Link from "next/link";
import { ReportActions } from "@/components/admin/admin-controls";
import { requireAdmin } from "@/lib/auth/session";
import { markdownExcerpt } from "@/lib/markdown/directives";
import { reasonLabel } from "@/lib/moderation/reasons";
import { listOpenReportGroups, type ReportGroup } from "@/lib/moderation/reports";

const TYPE_LABEL = { review: "Review", comment: "Comment", user: "Account" } as const;

export default async function ReportsPage() {
  await requireAdmin();
  const groups = await listOpenReportGroups();

  return (
    <section aria-labelledby="reports-heading">
      <h2 id="reports-heading" className="text-lg font-semibold">
        Open reports <span className="text-muted-foreground font-normal">{groups.length}</span>
      </h2>
      {groups.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">Nothing to review. 🎉</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {groups.map((g) => (
            <ReportCard key={`${g.targetType}:${g.targetId}`} group={g} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportCard({ group: g }: { group: ReportGroup }) {
  const t = g.target;
  const alreadyDown =
    !t ||
    (t.kind === "review" && (t.status === "hidden" || t.deleted)) ||
    (t.kind === "comment" && t.deleted) ||
    (t.kind === "user" && t.deleted);
  const suspended = t?.kind === "user" && t.status === "suspended";

  return (
    <li className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="bg-muted rounded px-1.5 py-0.5 text-xs font-medium">
            {TYPE_LABEL[g.targetType]}
          </span>{" "}
          <span className="font-semibold">
            {g.count} {g.count === 1 ? "report" : "reports"}
          </span>{" "}
          <span className="text-muted-foreground">· {g.reasons.map(reasonLabel).join(", ")}</span>
        </p>
        <time dateTime={g.lastAt.toISOString()} className="text-muted-foreground text-xs">
          {g.lastAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        </time>
      </div>

      {t?.kind === "review" && (
        <div className="bg-muted/50 space-y-1 rounded-lg p-3 text-sm">
          <p>
            <Link href={t.href} className="font-medium underline">
              {t.title ?? `Review of ${t.album}`}
            </Link>{" "}
            <span className="text-muted-foreground">
              by @{t.authorHandle} on {t.album}
              {t.status === "hidden" ? " · hidden" : ""}
            </span>
          </p>
          {t.body && <p className="text-muted-foreground">{markdownExcerpt(t.body, 300)}</p>}
        </div>
      )}
      {t?.kind === "comment" && (
        <div className="bg-muted/50 space-y-1 rounded-lg p-3 text-sm">
          <p className="text-muted-foreground">
            Comment by @{t.authorHandle}{" "}
            <Link href={t.href} className="underline">
              (view)
            </Link>
            {t.deleted ? " · removed" : ""}
          </p>
          <p className="break-words whitespace-pre-wrap">{t.body}</p>
        </div>
      )}
      {t?.kind === "user" && (
        <div className="bg-muted/50 rounded-lg p-3 text-sm">
          <Link href={t.href} className="font-medium underline">
            {t.displayName ?? t.handle} (@{t.handle})
          </Link>
          {suspended ? <span className="text-muted-foreground"> · suspended</span> : null}
        </div>
      )}
      {!t && <p className="text-muted-foreground text-sm">This content no longer exists.</p>}

      {g.details.length > 0 && (
        <ul className="text-muted-foreground space-y-1 text-xs">
          {g.details.slice(0, 3).map((d, i) => (
            <li key={i} className="break-words whitespace-pre-wrap">
              “{d}”
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        Reported by {g.reporters.map((h) => `@${h}`).join(", ")}
      </p>

      <ReportActions
        targetType={g.targetType}
        targetId={g.targetId}
        canHide={!alreadyDown}
        canSuspend={!!t && !suspended}
      />
    </li>
  );
}
