import { z } from "zod";

/**
 * "Report a problem" (Phase 12). Only what the member chooses to send is
 * stored: a category, their own description, the app path they came from,
 * and whether they're happy to be contacted. Never page contents, query
 * strings, fragments, screenshots, or tokens.
 */
export const PROBLEM_CATEGORIES = [
  { value: "sign_in", label: "Signing in or my account" },
  { value: "navigation", label: "Finding my way around" },
  { value: "content", label: "A page, form, or post" },
  { value: "media", label: "Audio, video, music, or photos" },
  { value: "notifications", label: "Notifications or email" },
  { value: "privacy", label: "Privacy or something I shouldn't see" },
  { value: "other", label: "Something else" },
] as const;

export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number]["value"];

export const PROBLEM_LIMITS = { description: 2000, path: 200 } as const;

const PATH_RE = /^\/([A-Za-z0-9._~%-]+(\/[A-Za-z0-9._~%-]+)*\/?)?$/;

/**
 * Reduces whatever we were given to a plain app path: drops any query string
 * or fragment, refuses absolute or protocol-relative URLs and anything with
 * unexpected characters, and never points back at the report page itself.
 * Returns null when nothing safe is left.
 */
export function sanitizePagePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const path = input.trim().split("#", 1)[0].split("?", 1)[0];
  if (!path || path.length > PROBLEM_LIMITS.path || !PATH_RE.test(path)) return null;
  if (path === "/report-problem" || path.startsWith("/report-problem/")) return null;
  return path;
}

export const problemReportSchema = z.object({
  category: z.enum(PROBLEM_CATEGORIES.map((c) => c.value) as [ProblemCategory, ...ProblemCategory[]], {
    error: "Choose what the problem is about.",
  }),
  description: z
    .string()
    .trim()
    .min(10, "Describe the problem in at least 10 characters.")
    .max(PROBLEM_LIMITS.description, `Keep the description to ${PROBLEM_LIMITS.description.toLocaleString("en-US")} characters.`),
  pagePath: z.unknown().transform(sanitizePagePath),
  contactOk: z.unknown().transform((v) => v === "on" || v === "true"),
});

export function categoryLabel(value: string): string {
  return PROBLEM_CATEGORIES.find((c) => c.value === value)?.label ?? "Something else";
}
