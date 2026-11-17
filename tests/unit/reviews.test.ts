import { describe, expect, it } from "vitest";
import { albumPath, parseAlbumSegment } from "@/lib/albums/paths";
import { aggregateReviews } from "@/lib/albums/stats";
import { MAX_TAGS, normalizeTag, normalizeTags, reviewInputSchema } from "@/lib/reviews/schema";
import { averageStars } from "@/components/album/rating-histogram";

const MBID = "0c5a3b3e-4b7c-4c2e-9c7a-2f5a6a1c9d11";
const base = {
  albumMbid: MBID,
  title: "",
  body: "",
  rating: null,
  clipTrackId: null,
  tags: [],
  status: "published" as const,
};

describe("review input validation", () => {
  it("accepts a rating-only log (no title, no body)", () => {
    const parsed = reviewInputSchema.parse({ ...base, rating: 7 });
    expect(parsed.title).toBeNull();
    expect(parsed.rating).toBe(7);
  });

  it("keeps 0 stars and no rating apart", () => {
    expect(reviewInputSchema.parse({ ...base, rating: 0 }).rating).toBe(0);
    expect(reviewInputSchema.parse({ ...base, rating: null }).rating).toBeNull();
  });

  it.each([-1, 11, 3.5, "5", Number.NaN])("rejects rating %j", (rating) => {
    expect(reviewInputSchema.safeParse({ ...base, rating }).success).toBe(false);
  });

  it("rejects a bad album id, a bad clip id and an unknown status", () => {
    expect(reviewInputSchema.safeParse({ ...base, albumMbid: "nope" }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, clipTrackId: "nope" }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...base, status: "hidden" }).success).toBe(false);
  });

  it("has no practical caption limit but does cap absurd bodies", () => {
    expect(reviewInputSchema.safeParse({ ...base, body: "x".repeat(15_000) }).success).toBe(true);
    expect(reviewInputSchema.safeParse({ ...base, body: "x".repeat(20_001) }).success).toBe(false);
  });

  it("normalizes tags and caps their number", () => {
    expect(normalizeTag("  #Post Rock  ")).toBe("post rock");
    expect(normalizeTag("<script>")).toBe("script");
    expect(normalizeTag("###")).toBe("");
    expect(normalizeTags(["Jazz", "jazz", " JAZZ ", ""])).toEqual(["jazz"]);
    const tooMany = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `tag${i}`);
    expect(reviewInputSchema.safeParse({ ...base, tags: tooMany }).success).toBe(false);
    expect(reviewInputSchema.parse({ ...base, tags: ["A", "a", "b"] }).tags).toEqual(["a", "b"]);
  });
});

describe("album URLs", () => {
  it("round-trips slug and MBID", () => {
    const path = albumPath({ slug: "kid-a", mbid: MBID });
    expect(path).toBe(`/albums/kid-a-${MBID}`);
    expect(parseAlbumSegment(`kid-a-${MBID}`)).toEqual({ slug: "kid-a", mbid: MBID });
  });

  it("works when the slug itself contains hyphens or looks like an id", () => {
    expect(parseAlbumSegment(`ok-computer-oknotok-${MBID}`)?.mbid).toBe(MBID);
  });

  it("accepts a bare MBID and rejects anything else", () => {
    expect(parseAlbumSegment(MBID)).toEqual({ slug: "", mbid: MBID });
    expect(parseAlbumSegment("kid-a")).toBeNull();
    expect(parseAlbumSegment(`kid-a_${MBID}`)).toBeNull();
    expect(parseAlbumSegment(`kid-a-${MBID.slice(1)}`)).toBeNull();
  });
});

describe("album statistics maths", () => {
  it("counts only rated entries toward the average and histogram", () => {
    const s = aggregateReviews([
      { rating: 10, body: "great" },
      { rating: 7, body: "" },
      { rating: 0, body: "" },
      { rating: null, body: "just listened" },
      { rating: null, body: "" },
    ]);
    expect(s.ratingCount).toBe(3);
    expect(s.ratingSum).toBe(17);
    expect(s.logCount).toBe(5);
    expect(s.reviewCount).toBe(2);
    expect(s.histogram[10]).toBe(1);
    expect(s.histogram[7]).toBe(1);
    expect(s.histogram[0]).toBe(1);
    expect(s.histogram.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("formats the average in stars to one decimal", () => {
    expect(averageStars(0, 0)).toBeNull();
    expect(averageStars(17, 3)).toBe("2.8"); // 17 half-stars / 3 = 5.67 half = 2.83 stars
    expect(averageStars(10, 1)).toBe("5.0");
  });
});
