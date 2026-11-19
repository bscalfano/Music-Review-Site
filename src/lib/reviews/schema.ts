import { z } from "zod";

export const MAX_BODY = 20_000;
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 30;

/** Lowercase, trimmed tag text, or "" if nothing usable is left. Letters, digits, spaces, - ' & . */
export function normalizeTag(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}\s\-'&.]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

export function normalizeTags(inputs: string[]): string[] {
  return [...new Set(inputs.map(normalizeTag).filter(Boolean))];
}

/** Half-star units: 0 = zero stars, 1..10 = half a star .. five stars. null = no rating. */
export const ratingSchema = z.number().int().min(0).max(10).nullable();

export const reviewInputSchema = z.object({
  albumMbid: z.uuid(),
  reviewId: z.uuid().nullish(),
  body: z
    .string()
    .max(MAX_BODY, `Reviews can be up to ${MAX_BODY.toLocaleString("en-US")} characters.`),
  rating: ratingSchema,
  clipTrackId: z.uuid().nullable(),
  favoriteTrackId: z.uuid().nullable().default(null),
  tags: z
    .array(z.string().max(100))
    .max(MAX_TAGS * 2)
    .transform(normalizeTags)
    .pipe(z.array(z.string()).max(MAX_TAGS, `Use at most ${MAX_TAGS} tags.`)),
  status: z.enum(["draft", "published"]),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

/** "Rated 3.5" style text for half-star units. */
export function formatRating(rating: number | null): string {
  if (rating === null) return "No rating";
  return `${rating / 2}★`;
}
