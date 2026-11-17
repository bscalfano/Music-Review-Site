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

  if (review.status === "hidden") {
    return (
      <main className="mx-auto max-w-xl space-y-3 px-4 py-12">
        <h1 className="text-2xl font-bold">This review was taken down</h1>
        <p className="text-muted-foreground text-sm">
          A moderator removed it for breaking the community guidelines, so it can&apos;t be edited
          or republished. If you think that was a mistake, get in touch using the contact address on
          the About page.
        </p>
      </main>
    );
  }

  const props = await loadEditor(album.mbid, { ...review, status: review.status }, user.handle);
  if (!props) notFound();
  return <ReviewEditor {...props} />;
}
