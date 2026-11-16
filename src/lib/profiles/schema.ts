import { z } from "zod";
import { normalizeHex } from "./contrast";
import { THEME_IDS } from "./themes";

/** Validation for everything a user can edit on their profile. Shared by actions and tests. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

/** https links only, with a real hostname and no embedded credentials. */
export const linkUrlSchema = z
  .string()
  .trim()
  .max(200)
  .transform((v, ctx) => {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
    try {
      const url = new URL(withScheme);
      if (
        url.protocol !== "https:" ||
        !url.hostname.includes(".") ||
        url.username ||
        url.password
      ) {
        throw new Error("bad url");
      }
      return url.toString();
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid https:// link." });
      return z.NEVER;
    }
  });

export const linkSchema = z.object({
  label: z.string().trim().min(1, "Add a label.").max(30, "Keep the label under 30 characters."),
  url: linkUrlSchema,
});

export const profileDetailsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Please enter a name.")
    .max(50, "Keep it under 50 characters."),
  bio: optionalText(300),
  pronouns: optionalText(20),
  location: optionalText(40),
  links: z.array(linkSchema).max(3, "You can add up to 3 links."),
});

export const appearanceSchema = z.object({
  themePreset: z.enum(THEME_IDS),
  accentColor: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const hex = normalizeHex(v);
      if (!hex) {
        ctx.addIssue({ code: "custom", message: "Enter a colour like #e4572e." });
        return z.NEVER;
      }
      return hex;
    }),
  gridShowRatings: z.boolean(),
});

export const favoritesSchema = z
  .array(z.uuid())
  .max(4, "You can pick up to 4 favorites.")
  .refine((ids) => new Set(ids).size === ids.length, "Each album can only be picked once.");

export type ProfileDetailsInput = z.input<typeof profileDetailsSchema>;
