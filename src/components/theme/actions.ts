"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, parseThemePreference } from "@/lib/theme/preference";

/** Saves the appearance choice for this device (works without JavaScript). */
export async function saveThemePreference(formData: FormData) {
  const theme = parseThemePreference(String(formData.get("theme") ?? ""));
  (await cookies()).set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
