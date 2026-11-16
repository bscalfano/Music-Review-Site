import { describe, expect, it } from "vitest";
import { aggregateReviews } from "@/lib/albums/stats";
import { retryDelayMinutes } from "@/lib/jobs/queue";

describe("aggregateReviews (album_stats maths)", () => {
  it("is all zeros for no reviews", () => {
    expect(aggregateReviews([])).toEqual({
      ratingCount: 0,
      ratingSum: 0,
      histogram: Array(11).fill(0),
      logCount: 0,
      reviewCount: 0,
    });
  });

  it("keeps 0 stars and no rating apart", () => {
    const stats = aggregateReviews([
      { rating: 0, body: "" }, // zero stars: counts as a rating
      { rating: null, body: "" }, // no rating: a log without a number
    ]);
    expect(stats.ratingCount).toBe(1);
    expect(stats.histogram[0]).toBe(1);
    expect(stats.logCount).toBe(2);
  });

  it("builds a half-star histogram and sums in half-star units", () => {
    const stats = aggregateReviews([
      { rating: 7, body: "great" }, // 3.5 stars
      { rating: 7, body: "" },
      { rating: 10, body: "  \n " }, // whitespace-only body is not a written review
      { rating: null, body: "just words" },
    ]);
    expect(stats.histogram[7]).toBe(2);
    expect(stats.histogram[10]).toBe(1);
    expect(stats.ratingCount).toBe(3);
    expect(stats.ratingSum).toBe(24);
    expect(stats.ratingSum / stats.ratingCount / 2).toBe(4); // average stars
    expect(stats.reviewCount).toBe(2);
    expect(stats.logCount).toBe(4);
  });
});

describe("job retry backoff", () => {
  it("doubles each attempt", () => {
    expect([1, 2, 3, 4].map(retryDelayMinutes)).toEqual([2, 4, 8, 16]);
  });
});
