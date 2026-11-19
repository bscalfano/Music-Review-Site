import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ListEditor } from "@/components/lists/list-editor";
import { requireUser } from "@/lib/auth/session";
import { albumCoverUrl } from "@/lib/music";
import { getListForEdit } from "@/lib/lists/service";

export const metadata: Metadata = { title: "Edit list", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

export default async function EditListPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser({ returnTo: `/write/list/${id}` });
  if (!z.uuid().safeParse(id).success) notFound();
  // Only the author can open the editor; anyone else gets a 404.
  const found = await getListForEdit(user.id, id);
  if (!found || found.list.status === "hidden") notFound();
  const { list, items } = found;
  return (
    <ListEditor
      listId={list.id}
      initial={{
        title: list.title,
        description: list.description ?? "",
        ranked: list.ranked,
        year: list.year,
        status: list.status === "published" ? "published" : "draft",
        items: items.map((i) => ({
          mbid: i.mbid,
          title: i.title,
          artistName: i.artistName,
          coverUrl: albumCoverUrl({ mbid: i.mbid, coverKey: i.coverKey }, 250),
          note: i.note ?? "",
        })),
      }}
    />
  );
}
