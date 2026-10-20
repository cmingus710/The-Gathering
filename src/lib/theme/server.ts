import "server-only";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseThemePreference, type ThemePreference } from "./preference";

export async function getThemePreference(): Promise<ThemePreference> {
  return parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
}
