import { RestoreButton } from "@/components/admin/admin-controls";
import { requireAdmin } from "@/lib/auth/session";
import { recentAdminActions } from "@/lib/moderation/service";

const LABEL: Record<string, string> = {
  hide_review: "hid a review",
  unhide_review: "restored a review",
  remove_comment: "removed a comment",
  restore_comment: "restored a comment",
  suspend_user: "suspended an account",
  unsuspend_user: "unsuspended an account",
  reset_avatar: "reset an avatar",
  reset_banner: "reset a banner",
  make_admin: "made someone an admin",
  remove_admin: "removed an admin",
};

export default async function ActivityPage() {
  await requireAdmin();
  const actions = await recentAdminActions(100);
  return (
    <section aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="text-lg font-semibold">
        Activity log
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Everything admins have done, most recent first. Use Restore to undo a takedown.
      </p>
      {actions.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">Nothing yet.</p>
      ) : (
        <ul className="mt-4 divide-y text-sm">
          {actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>
                <span className="font-medium">@{a.adminHandle ?? "unknown"}</span>{" "}
                {LABEL[a.action] ?? a.action}
                {a.note ? <span className="text-muted-foreground"> · “{a.note}”</span> : null}
              </span>
              {(a.action === "hide_review" || a.action === "remove_comment") && (
                <RestoreButton
                  kind={a.action === "hide_review" ? "review" : "comment"}
                  id={a.targetId}
                />
              )}
              <time dateTime={a.createdAt.toISOString()} className="text-muted-foreground text-xs">
                {a.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
