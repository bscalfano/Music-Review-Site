/** Handles are the `@name` in profile URLs (/u/name). Lowercase letters, digits and underscores. */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/** Names that would collide with routes or impersonate the site/staff. Keep sorted-ish by theme. */
export const RESERVED_HANDLES = new Set([
  // routes
  "u",
  "api",
  "feed",
  "discover",
  "write",
  "settings",
  "notifications",
  "search",
  "albums",
  "album",
  "artists",
  "artist",
  "lists",
  "shelves",
  "shelf",
  "list",
  "reviews",
  "review",
  "sign-in",
  "signin",
  "sign_in",
  "signout",
  "sign_out",
  "signup",
  "sign_up",
  "login",
  "logout",
  "register",
  "onboarding",
  "about",
  "terms",
  "privacy",
  "guidelines",
  "help",
  "support",
  "contact",
  "admin",
  "administrator",
  "static",
  "assets",
  "public",
  "uploads",
  "_next",
  "favicon",
  "robots",
  "sitemap",
  "rss",
  "feeds",
  "me",
  "new",
  "edit",
  "delete",
  "report",
  // staff / system
  "root",
  "system",
  "staff",
  "mod",
  "mods",
  "moderator",
  "moderators",
  "owner",
  "team",
  "official",
  "security",
  "abuse",
  "postmaster",
  "webmaster",
  "noreply",
  "no_reply",
  "null",
  "undefined",
  "anonymous",
  "deleted",
  "unknown",
]);

export type HandleResult = { ok: true; handle: string } | { ok: false; error: string };

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

export function validateHandle(input: string): HandleResult {
  const handle = normalizeHandle(input);
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return { ok: false, error: `Handles must be ${HANDLE_MIN}-${HANDLE_MAX} characters.` };
  }
  if (!/^[a-z0-9_]+$/.test(handle)) {
    return { ok: false, error: "Use only lowercase letters, numbers and underscores." };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, error: "That handle is reserved. Please pick another." };
  }
  return { ok: true, handle };
}
