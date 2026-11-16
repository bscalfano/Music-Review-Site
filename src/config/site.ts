/**
 * The ONLY place the site name and related branding live.
 * Everything else (metadata, emails, share images, RSS, manifest, legal pages)
 * must import `siteConfig`. To rename the site, set NEXT_PUBLIC_SITE_NAME.
 */
export const siteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || "Distortion",
  tagline:
    process.env.NEXT_PUBLIC_SITE_TAGLINE ||
    "Review the albums you love. Follow the people who love them.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  emailFrom: process.env.EMAIL_FROM || "noreply@example.com",
} as const;
