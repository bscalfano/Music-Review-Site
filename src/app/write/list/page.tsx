import type { Metadata } from "next";
import { ListEditor } from "@/components/lists/list-editor";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New list", robots: { index: false } };

export default async function NewListPage() {
  await requireUser({ returnTo: "/write/list" });
  return <ListEditor listId={null} initial={null} />;
}
