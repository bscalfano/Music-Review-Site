import { createHash } from "node:crypto";

/**
 * Instagram data-export parsing (S3). Pure functions, no I/O, so they're easy to test.
 *
 * Instagram's JSON export writes UTF-8 text as if each byte were a Latin-1 character, so "é"
 * arrives as "Ã©" and emoji as "ð\u009f\u0098\u008d". `fixMojibake` reverses that.
 */

/** Repairs Instagram's double-encoded text. Text that is already fine is returned unchanged. */
export function fixMojibake(text: string): string {
  // Real mojibake only ever contains code points <= 0xFF. Anything higher means it's already
  // proper text (or was never mangled), and re-decoding would corrupt it.
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) return text;
  const bytes = Buffer.from(text, "latin1");
  const decoded = bytes.toString("utf8");
  // A failed decode leaves U+FFFD behind: keep the original in that case.
  return decoded.includes("�") ? text : decoded;
}

export type ImportedPost = {
  /** Stable id so re-importing the same export doesn't create duplicates. */
  sourceKey: string;
  caption: string;
  postedAt: Date;
  /** Path of the first image inside the export, if any (kept for reference; not uploaded). */
  imagePath: string | null;
};

type RawMedia = { uri?: unknown; creation_timestamp?: unknown; title?: unknown };
type RawPost = { title?: unknown; creation_timestamp?: unknown; media?: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Accepts the contents of `posts_1.json` (a list of posts) and returns clean posts. Tolerates both
 * export layouts: caption on the post, or only on its first media item. Posts with no usable
 * timestamp are skipped. Returns the skipped count too, so the UI can say so.
 */
export function parsePostsJson(json: unknown): { posts: ImportedPost[]; skipped: number } {
  const list = Array.isArray(json)
    ? json
    : isRecord(json) && Array.isArray(json.posts)
      ? json.posts
      : null;
  if (!list) throw new Error("This doesn't look like an Instagram posts file (expected a list).");

  const posts: ImportedPost[] = [];
  let skipped = 0;
  for (const item of list) {
    if (!isRecord(item)) {
      skipped++;
      continue;
    }
    const post = item as RawPost;
    const media = (Array.isArray(post.media) ? post.media : []).filter(isRecord) as RawMedia[];
    const first = media[0];

    const rawTitle = typeof post.title === "string" ? post.title : first?.title;
    const caption = typeof rawTitle === "string" ? fixMojibake(rawTitle).trim() : "";
    const ts =
      typeof post.creation_timestamp === "number"
        ? post.creation_timestamp
        : typeof first?.creation_timestamp === "number"
          ? first.creation_timestamp
          : null;
    if (ts === null || !Number.isFinite(ts) || ts <= 0) {
      skipped++;
      continue;
    }
    const postedAt = new Date(ts * 1000);
    const imagePath = typeof first?.uri === "string" ? first.uri : null;
    posts.push({
      sourceKey: createHash("sha256").update(`${ts}\n${caption}`).digest("hex").slice(0, 32),
      caption,
      postedAt,
      imagePath,
    });
  }
  return { posts, skipped };
}

export type ParsedCaption = {
  /** Possible (artist, album) readings of the first line, best guess first. */
  candidates: { artist: string; title: string }[];
  /** Half-star units 0..10, when the caption states one. */
  rating: number | null;
  /** The caption with the headline and rating line removed, as markdown for the review body. */
  body: string;
  /** Hashtags (lowercase, no #), usable as tags. */
  hashtags: string[];
};

const DASHES = /\s+[–—-]\s+|\s*[–—]\s*/;

/** "4.5/5", "9/10", "★★★★½", "⭐⭐⭐⭐", "4 stars". Returns half-star units or null. */
export function parseRating(text: string): number | null {
  const outOf = text.match(/(?<![\d.])(\d{1,2}(?:\.\d)?)\s*\/\s*(5|10)\b/);
  if (outOf) {
    const value = Number(outOf[1]);
    const max = Number(outOf[2]);
    if (value >= 0 && value <= max) {
      const half = Math.round((value / max) * 10);
      return Math.max(0, Math.min(10, half));
    }
  }
  const stars = text.match(/([★⭐🌟]+)(½)?/u);
  if (stars) {
    const full = [...stars[1]].length;
    if (full <= 5) return Math.min(10, full * 2 + (stars[2] ? 1 : 0));
  }
  const word = text.match(/(?<![\d.])(\d(?:\.[05])?)\s*(?:stars?|\*)/i);
  if (word) {
    const value = Number(word[1]);
    if (value >= 0 && value <= 5) return Math.round(value * 2);
  }
  return null;
}

function cleanHeadline(line: string): string {
  return line
    .replace(/[#@]\S+/g, "") // hashtags/mentions
    .replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, "")
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/, "") // trailing "(1997)"
    .replace(/\s*\[(?:19|20)\d{2}\]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Guesses what album a caption is about. Captions usually start "Album – Artist" or
 * "Artist – Album" (or "Album by Artist"), so both readings are returned; the MusicBrainz search
 * then decides which one actually exists.
 */
export function parseCaption(caption: string): ParsedCaption {
  const lines = caption.replace(/\r\n?/g, "\n").split("\n");
  const firstIdx = lines.findIndex((l) => cleanHeadline(l) !== "");
  const headline = firstIdx >= 0 ? cleanHeadline(lines[firstIdx]) : "";

  const candidates: ParsedCaption["candidates"] = [];
  const add = (artist: string, title: string) => {
    artist = artist.trim();
    title = title.trim();
    if (!artist || !title) return;
    if (!candidates.some((c) => c.artist === artist && c.title === title)) {
      candidates.push({ artist, title });
    }
  };
  const by = headline.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) add(by[2], by[1]);
  const parts = headline.split(DASHES);
  if (parts.length === 2) {
    add(parts[0], parts[1]); // "Artist – Album"
    add(parts[1], parts[0]); // "Album – Artist"
  } else if (parts.length > 2) {
    // Dashes inside names ("Jay-Z" is safe, but "A – B – C" isn't): try the first split only.
    add(parts[0], parts.slice(1).join(" – "));
    add(parts.slice(1).join(" – "), parts[0]);
  }

  const rating = parseRating(caption);
  const hashtags = [
    ...new Set([...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase())),
  ];

  // Body: everything after the headline, minus a line that is only a rating or only hashtags.
  const rest = lines.slice(firstIdx + 1).filter((l) => {
    const t = l.trim();
    if (!t) return true;
    if (/^(?:#[\p{L}\p{N}_]+\s*)+$/u.test(t)) return false;
    if (/^[★⭐🌟½\s]+$/u.test(t)) return false;
    if (/^\d{1,2}(?:\.\d)?\s*\/\s*(?:5|10)\s*$/.test(t)) return false;
    return true;
  });
  const body = rest
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { candidates, rating, body, hashtags };
}
