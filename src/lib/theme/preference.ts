/**
 * Theme preference: "light" | "dark" | "system", stored per device in the
 * "theme" cookie so the server renders the right theme on the first paint.
 * Light is the fallback when nothing (or something unknown) is saved.
 */
export const THEME_COOKIE = "theme";
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export const DEFAULT_THEME: ThemePreference = "light";
/** One year; the choice is a per-device convenience, not account data. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value ?? "") ? (value as ThemePreference) : DEFAULT_THEME;
}
