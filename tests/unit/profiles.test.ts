import { describe, expect, it } from "vitest";
import { validateHandle } from "@/lib/auth/handles";
import { contrastRatio, ensureContrast, normalizeHex } from "@/lib/profiles/contrast";
import {
  appearanceSchema,
  favoritesSchema,
  linkSchema,
  profileDetailsSchema,
} from "@/lib/profiles/schema";
import {
  ACCENT_SWATCHES,
  MIN_ACCENT_CONTRAST,
  resolveProfileTheme,
  THEME_PRESETS,
} from "@/lib/profiles/themes";

describe("handles", () => {
  it.each([
    ["maya", "maya"],
    ["  @Maya_99 ", "maya_99"],
    ["a_b", "a_b"],
  ])("accepts %j as %s", (input, expected) => {
    expect(validateHandle(input)).toEqual({ ok: true, handle: expected });
  });

  it.each([
    "ab",
    "a".repeat(21),
    "has space",
    "dash-ed",
    "émile",
    "",
    "feed",
    "ADMIN",
    "settings",
    "u",
  ])("rejects %j", (input) => {
    expect(validateHandle(input).ok).toBe(false);
  });
});

describe("contrast maths", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
  });

  it("normalizes hex input", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #E4572E ")).toBe("#e4572e");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("leaves a readable colour alone", () => {
    expect(ensureContrast("#1f1f1f", "#ffffff")).toEqual({ color: "#1f1f1f", adjusted: false });
  });

  it("darkens an unreadable colour on a light background, keeping the hue", () => {
    const { color, adjusted } = ensureContrast("#f2f200", "#ffffff");
    expect(adjusted).toBe(true);
    expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(color).toMatch(/^#[0-9a-f]{2}[0-9a-f]{2}00$|^#[0-9a-f]{6}$/);
  });

  it("lightens an unreadable colour on a dark background", () => {
    const { color, adjusted } = ensureContrast("#101040", "#0b1220");
    expect(adjusted).toBe(true);
    expect(contrastRatio(color, "#0b1220")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("theme presets", () => {
  for (const preset of Object.values(THEME_PRESETS)) {
    for (const mode of ["light", "dark"] as const) {
      it(`${preset.id} (${mode}): text and default accent are readable`, () => {
        const t = preset[mode];
        expect(contrastRatio(t.foreground, t.background)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(t.mutedForeground, t.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.mutedForeground, t.card)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.accent, t.background)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("every accent swatch ends up readable on every preset, in both colour schemes", () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const swatch of ACCENT_SWATCHES) {
        const theme = resolveProfileTheme({ preset: preset.id, accentColor: swatch });
        expect(contrastRatio(theme.accent.light, preset.light.background)).toBeGreaterThanOrEqual(
          MIN_ACCENT_CONTRAST,
        );
        expect(contrastRatio(theme.accent.dark, preset.dark.background)).toBeGreaterThanOrEqual(
          MIN_ACCENT_CONTRAST,
        );
      }
    }
  });

  it("flags an accent that had to be adjusted, and not one that didn't", () => {
    expect(resolveProfileTheme({ preset: "paper", accentColor: "#f2f200" }).accentAdjusted).toBe(
      true,
    );
    expect(resolveProfileTheme({ preset: "default", accentColor: "#1f1f1f" }).accentAdjusted).toBe(
      true,
    ); // too dark for dark mode
    expect(resolveProfileTheme({ preset: "default" }).accentAdjusted).toBe(false);
  });

  it("ignores unknown presets and honours the viewer's 'default theme' opt-out", () => {
    expect(resolveProfileTheme({ preset: "hacked" }).themed).toBe(false);
    const forced = resolveProfileTheme({
      preset: "neon",
      accentColor: "#ff0000",
      forceDefault: true,
    });
    expect(forced.themed).toBe(false);
    expect(forced.style["--pt-bg-l"]).toBeUndefined();
  });

  it("only emits CSS variables, with colour values that are plain hex", () => {
    const { style } = resolveProfileTheme({ preset: "vinyl", accentColor: "#e4572e" });
    for (const [key, value] of Object.entries(style)) {
      expect(key).toMatch(/^--pt-[a-z-]+$/);
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("profile form validation", () => {
  it("accepts a valid profile and normalizes empty optionals to null", () => {
    const parsed = profileDetailsSchema.parse({
      displayName: " Maya ",
      bio: "",
      pronouns: "she/her",
      location: "",
      links: [],
    });
    expect(parsed).toEqual({
      displayName: "Maya",
      bio: null,
      pronouns: "she/her",
      location: null,
      links: [],
    });
  });

  it("enforces length limits and the 3-link cap", () => {
    const base = { displayName: "x", bio: "", pronouns: "", location: "", links: [] };
    expect(profileDetailsSchema.safeParse({ ...base, bio: "x".repeat(301) }).success).toBe(false);
    expect(profileDetailsSchema.safeParse({ ...base, displayName: "x".repeat(51) }).success).toBe(
      false,
    );
    const link = { label: "a", url: "https://a.com" };
    expect(
      profileDetailsSchema.safeParse({ ...base, links: [link, link, link, link] }).success,
    ).toBe(false);
  });

  it("only allows https links to real hosts, without credentials", () => {
    expect(linkSchema.safeParse({ label: "ig", url: "instagram.com/me" }).data?.url).toBe(
      "https://instagram.com/me",
    );
    for (const url of [
      "javascript:alert(1)",
      "http://insecure.com",
      "https://localhost",
      "https://user:pw@a.com",
      "data:text/html,hi",
      "ftp://a.com",
    ]) {
      expect(linkSchema.safeParse({ label: "x", url }).success, url).toBe(false);
    }
  });

  it("validates appearance: known presets, hex accents", () => {
    expect(
      appearanceSchema.safeParse({
        themePreset: "neon",
        accentColor: "#ABC",
        gridShowRatings: true,
      }).data?.accentColor,
    ).toBe("#aabbcc");
    expect(
      appearanceSchema.safeParse({ themePreset: "neon", accentColor: "", gridShowRatings: false })
        .data?.accentColor,
    ).toBeNull();
    expect(
      appearanceSchema.safeParse({ themePreset: "evil", accentColor: "", gridShowRatings: true })
        .success,
    ).toBe(false);
    expect(
      appearanceSchema.safeParse({
        themePreset: "neon",
        accentColor: "url(x)",
        gridShowRatings: true,
      }).success,
    ).toBe(false);
  });

  it("favorites: up to 4 distinct album ids", () => {
    const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    expect(favoritesSchema.safeParse(ids.slice(0, 4)).success).toBe(true);
    expect(favoritesSchema.safeParse(ids).success).toBe(false);
    expect(favoritesSchema.safeParse([ids[0], ids[0]]).success).toBe(false);
    expect(favoritesSchema.safeParse(["not-a-uuid"]).success).toBe(false);
    expect(favoritesSchema.safeParse([]).success).toBe(true);
  });
});
