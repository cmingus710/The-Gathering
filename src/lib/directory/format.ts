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

/** tel: link target, keeping only digits and a leading +. */
export function telHref(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

export function mailtoHref(email: string): string | null {
  const e = email.trim();
  return /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(e) ? `mailto:${e}` : null;
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
