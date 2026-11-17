import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private or per-user pages: nothing for a search engine to index.
      disallow: [
        "/api/",
        "/admin",
        "/settings",
        "/write",
        "/feed",
        "/notifications",
        "/onboarding",
        "/sign-in",
      ],
    },
    sitemap: new URL("/sitemap.xml", siteConfig.url).toString(),
  };
}
