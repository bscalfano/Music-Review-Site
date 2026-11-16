/** Colour maths for profile theming. Pure functions, safe to use on both server and client. */

export type RGB = [number, number, number];

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** Accepts #rgb or #rrggbb (any case); returns lowercase #rrggbb, or null if invalid. */
export function normalizeHex(input: string): string | null {
  const s = input.trim();
  if (HEX6.test(s)) return s.toLowerCase();
  if (HEX3.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  return null;
}

export function parseHex(hex: string): RGB {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`Invalid hex colour: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16)) as RGB;
}

export const toHex = ([r, g, b]: RGB): string =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = (t + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

/**
 * Returns `fg` if it already has enough contrast against `bg`; otherwise the closest colour with
 * the same hue and saturation that does (lightened on dark backgrounds, darkened on light ones),
 * falling back to white/black. `adjusted` tells the caller whether it had to change anything.
 */
export function ensureContrast(
  fg: string,
  bg: string,
  min = 4.5,
): { color: string; adjusted: boolean } {
  const start = normalizeHex(fg);
  if (!start) throw new Error(`Invalid hex colour: ${fg}`);
  if (contrastRatio(start, bg) >= min) return { color: start, adjusted: false };

  const lighten = relativeLuminance(bg) < 0.4;
  const [h, s, l] = rgbToHsl(parseHex(start));
  for (let step = 1; step <= 100; step++) {
    const nl = lighten ? l + step / 100 : l - step / 100;
    if (nl < 0 || nl > 1) break;
    const candidate = toHex(hslToRgb([h, s, nl]));
    if (contrastRatio(candidate, bg) >= min) return { color: candidate, adjusted: true };
  }
  return { color: lighten ? "#ffffff" : "#000000", adjusted: true };
}
