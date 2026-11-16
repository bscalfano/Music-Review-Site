/**
 * Feature flags. Env-driven booleans so unfinished features can ship dark.
 * Set e.g. FEATURE_LISTS=true in .env.local to turn one on.
 * Core features (reviews, follows, feed) are not flagged.
 */
const flag = (name: string, defaultValue = false): boolean => {
  const v = process.env[name];
  if (v === undefined) return defaultValue;
  return v === "true" || v === "1";
};

export const features = {
  lists: flag("FEATURE_LISTS"), // S11
  queue: flag("FEATURE_QUEUE"), // S14
  stats: flag("FEATURE_STATS"), // S10
  search: flag("FEATURE_SEARCH"), // S9
  artistPages: flag("FEATURE_ARTIST_PAGES"), // S12
  platformLinks: flag("FEATURE_PLATFORM_LINKS"), // S13
  instagramImport: flag("FEATURE_INSTAGRAM_IMPORT"), // S3
} as const;

export type FeatureName = keyof typeof features;
