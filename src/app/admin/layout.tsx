import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const TABS = [
  { href: "/admin", label: "Reports" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/activity", label: "Activity log" },
];

/** Everything under /admin: admins and the owner only (anyone else gets a 404). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold">Admin</h1>
      <nav aria-label="Admin sections" className="mt-4 flex gap-5 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="-mb-px border-b-2 border-transparent pb-2 hover:border-current"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </main>
  );
}
