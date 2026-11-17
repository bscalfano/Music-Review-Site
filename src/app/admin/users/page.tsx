import Link from "next/link";
import { UserControls } from "@/components/admin/admin-controls";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";
import { searchUsers } from "@/lib/moderation/service";

type Props = { searchParams: Promise<{ q?: string }> };

export default async function UsersPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  const { q = "" } = await searchParams;
  const people = await searchUsers(q);

  return (
    <section aria-labelledby="users-heading">
      <h2 id="users-heading" className="text-lg font-semibold">
        Users
      </h2>
      <form className="mt-3 flex gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search handle, name or email"
          aria-label="Search users"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <ul className="mt-4 divide-y">
        {people.map((p) => (
          <li key={p.id} className="space-y-2 py-3">
            <p className="text-sm">
              {p.handle ? (
                <Link href={`/u/${p.handle}`} className="font-semibold hover:underline">
                  @{p.handle}
                </Link>
              ) : (
                <span className="text-muted-foreground">(no handle yet)</span>
              )}{" "}
              <span className="text-muted-foreground">
                {p.displayName ? `${p.displayName} · ` : ""}
                {p.email}
              </span>
            </p>
            <p className="text-muted-foreground flex flex-wrap gap-2 text-xs">
              <span>Joined {p.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
              {p.role !== "member" && <span className="font-medium">· {p.role}</span>}
              {p.status === "suspended" && (
                <span className="text-destructive font-medium">· suspended</span>
              )}
              {p.deletedAt && <span className="font-medium">· deletion pending</span>}
            </p>
            <UserControls
              userId={p.id}
              suspended={p.status === "suspended"}
              isTargetAdmin={p.role === "admin"}
              isOwnerViewer={admin.role === "owner"}
              isSelfOrOwner={
                p.id === admin.id ||
                p.role === "owner" ||
                (p.role === "admin" && admin.role !== "owner")
              }
            />
          </li>
        ))}
        {people.length === 0 && (
          <li className="text-muted-foreground py-8 text-center text-sm">No one found.</li>
        )}
      </ul>
    </section>
  );
}
