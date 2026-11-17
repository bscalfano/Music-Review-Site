import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AlbumChooser } from "@/components/write/album-chooser";
import { ensureAlbum } from "@/lib/albums/ensure-album";
import { requireUser } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs";
import { getOwnReviewForAlbum } from "@/lib/reviews/queries";
import { loadEditor } from "./editor-data";
import { ReviewEditor } from "@/components/write/review-editor";

export const metadata: Metadata = { title: "Write a review", robots: { index: false } };

type Props = { searchParams: Promise<{ album?: string }> };

export default async function WritePage({ searchParams }: Props) {
  const { album: albumParam } = await searchParams;
  const user = await requireUser({
    returnTo: albumParam ? `/write?album=${encodeURIComponent(albumParam)}` : "/write",
  });

  const mbid = z.uuid().safeParse(albumParam);
  if (!mbid.success) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <h1 className="text-2xl font-bold">Write a review</h1>
        <p className="text-muted-foreground text-sm">
          Which album? Search our library, or all of MusicBrainz.
        </p>
        <AlbumChooser />
      </main>
    );
  }

  const album = await ensureAlbum(mbid.data);
  if (!album) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <h1 className="text-2xl font-bold">Album not found</h1>
        <p className="text-muted-foreground text-sm">
          We couldn&apos;t find that album right now. Try searching again.
        </p>
        <AlbumChooser />
      </main>
    );
  }
  kickJobs(); // fills in the track list and cover if this album is new

  // One review per album per person: writing about an album you've covered edits it.
  const existing = await getOwnReviewForAlbum(user.id, album.id);
  if (existing) redirect(`/write/${existing.id}`);

  const props = await loadEditor(album.mbid, null, user.handle);
  if (!props) redirect("/write");
  return <ReviewEditor {...props} />;
}
