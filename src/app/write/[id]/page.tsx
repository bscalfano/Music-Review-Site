import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ReviewEditor } from "@/components/write/review-editor";
import { requireUser } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs";
import { getOwnReview } from "@/lib/reviews/queries";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { loadEditor } from "../editor-data";

export const metadata: Metadata = { title: "Edit review", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

export default async function EditReviewPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser({ returnTo: `/write/${id}` });
  if (!z.uuid().safeParse(id).success) notFound();

  // Only the author can open the editor; anyone else gets the same 404 as a missing review.
  const review = await getOwnReview(user.id, id);
  if (!review) notFound();

  const [album] = await getDb()
    .select({ mbid: schema.albums.mbid })
    .from(schema.albums)
    .where(eq(schema.albums.id, review.albumId))
    .limit(1);
  if (!album) notFound();
  kickJobs();

  const props = await loadEditor(album.mbid, review, user.handle);
  if (!props) notFound();
  return <ReviewEditor {...props} />;
}
