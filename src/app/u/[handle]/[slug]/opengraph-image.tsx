import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";
import { getCurrentUser, toViewer } from "@/lib/auth/session";
import { albumCoverUrl } from "@/lib/music";
import { getReviewPage } from "@/lib/reviews/queries";

export const alt = "Album review";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STAR =
  "M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52 6.12 20.6l1.12-6.55L2.48 9.42l6.58-.96L12 2.5z";

function Stars({ rating, px }: { rating: number; px: number }) {
  const star = (color: string) => (
    <svg width={px} height={px} viewBox="0 0 24 24">
      <path d={STAR} fill={color} />
    </svg>
  );
  return (
    <div style={{ display: "flex" }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const full = rating >= 2 * (i + 1);
        const half = rating === 2 * i + 1;
        return (
          <div key={i} style={{ display: "flex", position: "relative", width: px, height: px }}>
            {star("#4b5563")}
            {(full || half) && (
              <div
                style={{
                  display: "flex",
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: half ? px / 2 : px,
                  height: px,
                  overflow: "hidden",
                }}
              >
                {star("#fbbf24")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const absolute = (url: string) =>
  url.startsWith("/") ? new URL(url, siteConfig.url).toString() : url;

/**
 * Share image for a review (S22): cover, album, artist, reviewer and stars. Private accounts
 * show the album only, with no rating or reviewer. Anything the viewer may not see gets the
 * generic site image, the same as a review that doesn't exist.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const data = await getReviewPage(handle, slug, toViewer(await getCurrentUser()));
  const shell = {
    width: 1200,
    height: 630,
    display: "flex",
    background: "#111827",
    color: "#f9fafb",
  } as const;

  if (!data || data.review.status !== "published") {
    return new ImageResponse(
      <div
        style={{
          ...shell,
          alignItems: "center",
          justifyContent: "center",
          fontSize: 72,
          fontWeight: 700,
        }}
      >
        {siteConfig.name}
      </div>,
      size,
    );
  }

  const { review, author, album } = data;
  const isPrivate = author.isPrivate;
  const name = author.displayName ?? `@${author.handle}`;

  return new ImageResponse(
    <div style={{ ...shell, alignItems: "center", padding: 60, gap: 60 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={absolute(albumCoverUrl(album, 500))}
        width={480}
        height={480}
        alt=""
        style={{ borderRadius: 16, objectFit: "cover", background: "#374151" }}
      />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 18 }}>
        <div style={{ display: "flex", fontSize: 58, fontWeight: 700, lineHeight: 1.1 }}>
          {album.title.length > 60 ? `${album.title.slice(0, 57)}…` : album.title}
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#9ca3af" }}>{album.artist.name}</div>
        {!isPrivate && review.rating !== null && (
          <div style={{ display: "flex", marginTop: 16 }}>
            {review.rating === 0 ? (
              <div style={{ display: "flex", fontSize: 44, color: "#9ca3af" }}>0 stars</div>
            ) : (
              <Stars rating={review.rating} px={56} />
            )}
          </div>
        )}
        {!isPrivate && (
          <div style={{ display: "flex", fontSize: 30, marginTop: 8 }}>Reviewed by {name}</div>
        )}
        <div style={{ display: "flex", fontSize: 26, color: "#6b7280", marginTop: "auto" }}>
          {siteConfig.name}
        </div>
      </div>
    </div>,
    size,
  );
}
