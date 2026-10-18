/**
 * Sanitizes a post-sign-in "next" path so it can only point inside this app.
 * Rejects absolute URLs, protocol-relative URLs ("//evil.test"), backslash
 * tricks, and anything that is not a plain path.
 */
export function safeNextPath(value: unknown, fallback = "/home"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(trimmed)) return fallback;
  try {
    const url = new URL(trimmed, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return fallback;
    if (url.pathname.startsWith("/auth/")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
