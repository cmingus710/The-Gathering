export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "March 7". Month and day only; no year is ever collected. */
export function formatBirthday(month: number | null | undefined, day: number | null | undefined): string | null {
  if (!month || !day || month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${day}`;
}

/** Up to two initials for the photo fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

/**
 * Dialable form of a stored phone number, for tel:/sms: links only. The
 * stored value is never changed and is still what's displayed. Keeps digits
 * and a leading +; drops the "(0)" trunk digit written after a country code
 * (+44 (0)20 … dials as +4420 …). E.164 allows at most 15 digits.
 */
export function dialable(phone: string): string | null {
  let trimmed = phone.trim();
  const international = trimmed.startsWith("+");
  if (international) trimmed = trimmed.replace(/\(\s*0\s*\)/g, "");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${international ? "+" : ""}${digits}`;
}

/** tel: link target, or null when the number can't be dialled. */
export function telHref(phone: string): string | null {
  const d = dialable(phone);
  return d ? `tel:${d}` : null;
}

/** sms: link target (text message), or null when the number can't be used. */
export function smsHref(phone: string): string | null {
  const d = dialable(phone);
  return d ? `sms:${d}` : null;
}

export function mailtoHref(email: string): string | null {
  const e = email.trim();
  return /^[^@\s<>"?&#%]+@[^@\s<>"?&#%]+\.[^@\s<>"?&#%]+$/.test(e) ? `mailto:${e}` : null;
}

/** One line for a map search: the shared parts of an address, in order. */
export function addressQuery(parts: Array<string | null | undefined>): string | null {
  const q = parts
    .map((p) => (p ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
  return q.length >= 3 ? q.slice(0, 300) : null;
}

/**
 * HTTPS map links that work on every device: Google's documented Maps URLs
 * (api=1) open the Google Maps app when it's installed and the website
 * otherwise; Apple's maps.apple.com links open Apple Maps on Apple devices and
 * the Apple Maps website elsewhere. A website can't choose the phone's default
 * navigation app, so both are offered and the member picks.
 */
export function mapLinks(query: string | null): { map: string; directions: string; apple: string } | null {
  if (!query) return null;
  const q = encodeURIComponent(query);
  return {
    map: `https://www.google.com/maps/search/?api=1&query=${q}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    apple: `https://maps.apple.com/?daddr=${q}`,
  };
}

export function cityLine(city: string | null | undefined, state: string | null | undefined, postal?: string | null): string | null {
  const place = [city, state].filter(Boolean).join(", ");
  const line = [place, postal].filter(Boolean).join(" ");
  return line || null;
}

export const DIRECTORY_PAGE_SIZE = 24;

/** Page number from a search param: 1-based, bounded. */
export function parsePage(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : 1;
  return Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 1;
}

/** Search text from a search param: trimmed and bounded. */
export function parseQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}
