import { describe, expect, it } from "vitest";
import { checkProductionEnv } from "@/lib/env-check";
import { buildRssFeed, xmlEscape } from "@/lib/rss";
import type { FeedItem } from "@/lib/social/feed";

const good = {
  DATABASE_URL: "postgres://x",
  AUTH_SECRET: "s",
  CRON_SECRET: "c",
  OWNER_EMAIL: "me@real.org",
  TURNSTILE_SECRET_KEY: "t",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "t",
  NEXT_PUBLIC_SITE_URL: "https://reviews.real.org",
  AUTH_GOOGLE_ID: "id",
  AUTH_GOOGLE_SECRET: "secret",
  R2_ACCOUNT_ID: "a",
  R2_ACCESS_KEY_ID: "b",
  R2_SECRET_ACCESS_KEY: "c",
  R2_BUCKET: "bucket",
  R2_PUBLIC_URL: "https://cdn.real.org",
  NEXT_PUBLIC_CONTACT_EMAIL: "hi@real.org",
  EMAIL_FROM: "Site <hello@real.org>",
  MUSICBRAINZ_USER_AGENT: "Site/1.0 ( hi@real.org )",
};

describe("production env check", () => {
  it("passes a complete configuration with no issues", () => {
    expect(checkProductionEnv(good)).toEqual([]);
  });

  it("flags each missing required variable", () => {
    for (const name of [
      "DATABASE_URL",
      "AUTH_SECRET",
      "CRON_SECRET",
      "OWNER_EMAIL",
      "TURNSTILE_SECRET_KEY",
    ]) {
      const issues = checkProductionEnv({ ...good, [name]: "" });
      expect(
        issues.some((i) => i.level === "required" && i.name === name),
        name,
      ).toBe(true);
    }
  });

  it("requires a public https site URL", () => {
    for (const url of ["", "http://localhost:3000", "http://reviews.real.org"]) {
      expect(
        checkProductionEnv({ ...good, NEXT_PUBLIC_SITE_URL: url }).some(
          (i) => i.name === "NEXT_PUBLIC_SITE_URL",
        ),
        url,
      ).toBe(true);
    }
  });

  it("needs at least one sign-in method and complete Google keys", () => {
    const none = { ...good, AUTH_GOOGLE_ID: "", AUTH_GOOGLE_SECRET: "" };
    expect(checkProductionEnv(none).some((i) => i.name.includes("RESEND_API_KEY"))).toBe(true);
    expect(checkProductionEnv({ ...none, RESEND_API_KEY: "re_x" })).toEqual([]);
    expect(
      checkProductionEnv({ ...good, AUTH_GOOGLE_SECRET: "" }).some(
        (i) => i.name === "AUTH_GOOGLE_SECRET",
      ),
    ).toBe(true);
  });

  it("requires storage in production, since there is no local fallback", () => {
    expect(
      checkProductionEnv({ ...good, R2_BUCKET: "" }).some(
        (i) => i.level === "required" && i.name.includes("R2_BUCKET"),
      ),
    ).toBe(true);
  });

  it("only recommends (not requires) contact, sender and MusicBrainz agent", () => {
    const issues = checkProductionEnv({
      ...good,
      NEXT_PUBLIC_CONTACT_EMAIL: "",
      EMAIL_FROM: "Distortion <noreply@example.com>",
      MUSICBRAINZ_USER_AGENT: "YourSiteName/0.1 ( your-contact@example.com )",
    });
    expect(issues.map((i) => i.level)).toEqual(["recommended", "recommended", "recommended"]);
  });
});

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: "1",
  slug: "kid-a",
  body: "A **great** record & more <b>",
  rating: 9,
  publishedAt: new Date("2026-03-03T12:00:00Z"),
  hearts: 0,
  viewerHearted: null,
  comments: 0,
  author: { handle: "bri", displayName: "Bri <script>", image: null },
  album: { mbid: "m", slug: "kid-a", title: "Kid A", coverKey: null },
  artistName: "Radiohead & co",
  artistSlug: "radiohead",
  clip: null,
  ...over,
});

describe("RSS", () => {
  it("escapes XML special characters", () => {
    expect(xmlEscape(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &apos; f");
    expect(xmlEscape("bad\u0000char")).toBe("badchar");
  });

  it("builds a feed with escaped, safe content", () => {
    const xml = buildRssFeed({
      title: "Bri & friends",
      description: "d",
      link: "/u/bri",
      self: "/u/bri/rss.xml",
      items: [item()],
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<title>Bri &amp; friends</title>");
    expect(xml).toContain("<title>Kid A · Radiohead &amp; co (4.5/5)</title>");
    expect(xml).toContain("/u/bri/kid-a</link>");
    expect(xml).toContain("<pubDate>Tue, 03 Mar 2026 12:00:00 GMT</pubDate>");
    expect(xml).toContain("Bri &lt;script&gt;");
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;b&gt;"); // raw HTML in a review stays inert text
  });

  it("builds a valid empty feed", () => {
    const xml = buildRssFeed({
      title: "t",
      description: "d",
      link: "/",
      self: "/rss.xml",
      items: [],
    });
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });
});
