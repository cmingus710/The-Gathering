export type Frequency = "one_time" | "weekly" | "monthly";

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  one_time: "One time",
  weekly: "Every week",
  monthly: "Every month",
};

/**
 * Parses a dollar amount typed by a person ("25", "25.5", "$1,000.00") into
 * integer cents. Returns null for anything that isn't a plain positive amount
 * with at most two decimal places.
 */
export function parseDollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function formatCents(cents: number, opts: { signed?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const s = `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  if (cents < 0) return `−${s}`;
  return opts.signed ? `+${s}` : s;
}
