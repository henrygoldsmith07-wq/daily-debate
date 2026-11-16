import type { CSSProperties } from "react";

/**
 * Today's accent colour. Each motion day gets one hue from a fixed palette, so
 * Today looks different from yesterday without anyone choosing a colour. It is
 * decoration only: the accent marks the motion card's stripe and kicker dot,
 * never text a reader has to read, so contrast rules stay with the theme.
 *
 * Deterministic on the date key (YYYY-MM-DD): server and client agree, and a
 * reload never changes the day's colour.
 */
export const DAILY_ACCENT_HUES = [12, 38, 145, 190, 222, 262, 318] as const;

const DAY_MS = 86_400_000;

export function dailyAccentHue(dateKey: string): number {
  const time = Date.parse(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(time)) return DAILY_ACCENT_HUES[0];
  const day = Math.floor(time / DAY_MS);
  const index = ((day % DAILY_ACCENT_HUES.length) + DAILY_ACCENT_HUES.length) % DAILY_ACCENT_HUES.length;
  return DAILY_ACCENT_HUES[index];
}

/** The CSS custom property the motion card reads (`--motion-accent`). */
export function dailyAccentStyle(dateKey: string): CSSProperties {
  return { "--motion-accent": `oklch(0.72 0.16 ${dailyAccentHue(dateKey)})` } as CSSProperties;
}
