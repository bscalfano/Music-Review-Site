import { ensureContrast, normalizeHex } from "./contrast";

/**
 * Profile theme presets. This is the ONE place to add or change themes: add an entry below
 * and it appears in settings automatically. Users can never supply CSS, HTML or fonts; they
 * pick a preset and an accent colour, and both are applied as CSS variables (see globals.css).
 */

export type ThemeTokens = {
  background: string;
  foreground: string;
  card: string;
  mutedForeground: string;
  border: string;
  /** Default accent when the user hasn't chosen one. */
  accent: string;
};

export type ThemePreset = {
  id: string;
  label: string;
  /** When false the preset leaves the site's own colours alone (and only the accent applies). */
  overrides: boolean;
  light: ThemeTokens;
  dark: ThemeTokens;
};

const midnight: ThemeTokens = {
  background: "#0b1220",
  foreground: "#e6edf7",
  card: "#131c30",
  mutedForeground: "#9aa8c0",
  border: "#24324d",
  accent: "#7cb7ff",
};
const neon: ThemeTokens = {
  background: "#0a0a12",
  foreground: "#f4f4ff",
  card: "#141422",
  mutedForeground: "#a5a5c8",
  border: "#2b2b45",
  accent: "#ff4fd8",
};

export const THEME_PRESETS = {
  default: {
    id: "default",
    label: "Default",
    overrides: false,
    light: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      card: "#ffffff",
      mutedForeground: "#737373",
      border: "#e5e5e5",
      accent: "#171717",
    },
    dark: {
      background: "#0a0a0a",
      foreground: "#fafafa",
      card: "#171717",
      mutedForeground: "#a3a3a3",
      border: "#262626",
      accent: "#fafafa",
    },
  },
  midnight: { id: "midnight", label: "Midnight", overrides: true, light: midnight, dark: midnight },
  paper: {
    id: "paper",
    label: "Paper",
    overrides: true,
    light: {
      background: "#f6f1e7",
      foreground: "#2b2620",
      card: "#fffaf0",
      mutedForeground: "#6b6256",
      border: "#dfd4bf",
      accent: "#9c4a1a",
    },
    dark: {
      background: "#1d1914",
      foreground: "#efe6d6",
      card: "#27221b",
      mutedForeground: "#b0a592",
      border: "#3a3328",
      accent: "#e0a46b",
    },
  },
  neon: { id: "neon", label: "Neon", overrides: true, light: neon, dark: neon },
  vinyl: {
    id: "vinyl",
    label: "Vinyl",
    overrides: true,
    light: {
      background: "#efe9dd",
      foreground: "#1a1a1a",
      card: "#f7f2e8",
      mutedForeground: "#5e574b",
      border: "#d6cebd",
      accent: "#b23a2e",
    },
    dark: {
      background: "#121212",
      foreground: "#f2efe9",
      card: "#1c1c1c",
      mutedForeground: "#a8a39a",
      border: "#2c2c2c",
      accent: "#e8744a",
    },
  },
} as const satisfies Record<string, ThemePreset>;

export type ThemeId = keyof typeof THEME_PRESETS;
export const THEME_IDS = Object.keys(THEME_PRESETS) as [ThemeId, ...ThemeId[]];

export function isThemeId(value: string): value is ThemeId {
  return Object.hasOwn(THEME_PRESETS, value);
}

/** Twelve swatches offered in the accent picker (custom hex is also allowed). */
export const ACCENT_SWATCHES = [
  "#e4572e",
  "#f2a541",
  "#e8c547",
  "#6bb35a",
  "#2a9d8f",
  "#2e86ab",
  "#4361ee",
  "#7b2cbf",
  "#d6489a",
  "#c1121f",
  "#6c757d",
  "#1f1f1f",
] as const;

export const MIN_ACCENT_CONTRAST = 4.5; // WCAG AA for normal text

export type ResolvedTheme = {
  /** True when the preset overrides the site colours (adds data-themed on the wrapper). */
  themed: boolean;
  /** Inline CSS variables for the profile wrapper. */
  style: Record<string, string>;
  /** The accent that will actually be used, per colour scheme, after the contrast fix-up. */
  accent: { light: string; dark: string };
  /** True if the chosen accent had to be lightened/darkened to stay readable. */
  accentAdjusted: boolean;
};

/**
 * Turns a user's saved choices into CSS variables. The accent is nudged until it meets WCAG AA
 * contrast against the preset's background in BOTH light and dark mode, so no combination of
 * choices can produce unreadable links or buttons. `forceDefault` implements the viewer's
 * "show profiles in the default theme" accessibility setting.
 */
export function resolveProfileTheme(opts: {
  preset?: string | null;
  accentColor?: string | null;
  forceDefault?: boolean;
}): ResolvedTheme {
  const preset =
    !opts.forceDefault && opts.preset && isThemeId(opts.preset)
      ? THEME_PRESETS[opts.preset]
      : THEME_PRESETS.default;
  const chosen = opts.forceDefault || !opts.accentColor ? null : normalizeHex(opts.accentColor);

  const accentFor = (mode: "light" | "dark") =>
    ensureContrast(chosen ?? preset[mode].accent, preset[mode].background, MIN_ACCENT_CONTRAST);
  const light = accentFor("light");
  const dark = accentFor("dark");

  const style: Record<string, string> = {
    "--pt-accent-l": light.color,
    "--pt-accent-d": dark.color,
  };
  if (preset.overrides) {
    for (const [mode, key] of [
      ["light", "l"],
      ["dark", "d"],
    ] as const) {
      const t = preset[mode];
      style[`--pt-bg-${key}`] = t.background;
      style[`--pt-fg-${key}`] = t.foreground;
      style[`--pt-card-${key}`] = t.card;
      style[`--pt-muted-${key}`] = t.mutedForeground;
      style[`--pt-border-${key}`] = t.border;
    }
  }
  return {
    themed: preset.overrides,
    style,
    accent: { light: light.color, dark: dark.color },
    accentAdjusted: !!chosen && (light.adjusted || dark.adjusted),
  };
}
