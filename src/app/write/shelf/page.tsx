import type { Metadata } from "next";
import { ListEditor } from "@/components/lists/list-editor";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New shelf", robots: { index: false } };

export default async function NewListPage() {
  await requireUser({ returnTo: "/write/shelf" });
  return <ListEditor listId={null} initial={null} />;
}
