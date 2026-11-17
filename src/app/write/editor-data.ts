import { albumCoverUrl } from "@/lib/music";
import { albumPath } from "@/lib/albums/paths";
import { getAlbumByMbid, getAlbumTracks, type OwnReview } from "@/lib/reviews/queries";
import { REVIEW_IMAGE_PREFIX } from "@/lib/images/process";
import { storagePublicUrl } from "@/lib/storage/r2";

/** Everything the editor component needs, built on the server. */
export async function loadEditor(
  albumMbid: string,
  review: (Omit<OwnReview, "status"> & { status: "draft" | "published" }) | null,
  handle: string,
) {
  const album = await getAlbumByMbid(albumMbid);
  if (!album) return null;
  const tracks = await getAlbumTracks(album.id);
  const imagePrefix = storagePublicUrl(REVIEW_IMAGE_PREFIX);
  return {
    album: {
      mbid: album.mbid,
      title: album.title,
      artistName: album.artist.name,
      coverUrl: albumCoverUrl(album, 250),
      albumHref: albumPath(album),
    },
    tracks: tracks.map((t) => ({
      id: t.id,
      position: t.position,
      title: t.title,
      previewUrl: t.previewUrl,
    })),
    initial: review
      ? {
          id: review.id,
          slug: review.slug,
          title: review.title,
          body: review.body,
          rating: review.rating,
          clipTrackId: review.clipTrackId,
          tags: review.tags,
          status: review.status,
        }
      : null,
    imagePrefixes: imagePrefix ? [imagePrefix] : [],
    handle,
  };
}
