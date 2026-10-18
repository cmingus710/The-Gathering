import { z } from "zod";
import { optionalText } from "@/lib/forms";
import { isValidTimeZone } from "@/lib/time";

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

export const SOCIAL_NETWORKS = ["website", "facebook", "instagram", "youtube"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export const SOCIAL_LABEL: Record<SocialNetwork, string> = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
};

export const gatheringTimeSchema = z.object({
  label: z.string().trim().min(1, "Give this gathering a name.").max(80, "Use 80 characters or fewer."),
  day: z.enum(WEEKDAYS, { error: "Choose a day." }),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time."),
  location: z
    .string()
    .trim()
    .max(120, "Use 120 characters or fewer.")
    .transform((v) => v || null),
});
export type GatheringTime = z.output<typeof gatheringTimeSchema>;

const httpsUrl = z
  .string()
  .trim()
  .max(300, "Use 300 characters or fewer.")
  .refine((v) => {
    if (v === "") return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a full web address starting with https://");

export const settingsSchema = z.object({
  churchName: z.string().trim().min(1, "Enter the church name.").max(120, "Use 120 characters or fewer."),
  description: optionalText(2000, "The description"),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address.")
    .transform((v) => v || null),
  contactPhone: z
    .string()
    .trim()
    .max(40, "Use 40 characters or fewer.")
    .refine((v) => v === "" || /^[0-9+().\-\s]{7,40}$/.test(v), "Enter a phone number using digits, spaces, and + ( ) - only.")
    .transform((v) => v || null),
  addressLine1: optionalText(120, "Address line 1"),
  addressLine2: optionalText(120, "Address line 2"),
  city: optionalText(80, "City"),
  region: optionalText(80, "State"),
  postalCode: optionalText(20, "ZIP code"),
  country: optionalText(80, "Country"),
  timezone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone."),
  gatheringTimes: z.array(gatheringTimeSchema).max(12, "Add up to 12 gathering times."),
  socialLinks: z.object(Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, httpsUrl])) as Record<SocialNetwork, typeof httpsUrl>),
});

export type SettingsInput = z.input<typeof settingsSchema>;

/** Reads the repeated gathering-time rows ("gathering[0][label]" …) from FormData. */
export function readGatheringRows(formData: FormData): Array<Record<string, string>> {
  const rows = new Map<number, Record<string, string>>();
  for (const [key, value] of formData.entries()) {
    const m = /^gathering\[(\d+)\]\[(label|day|time|location)\]$/.exec(key);
    if (!m || typeof value !== "string") continue;
    const index = Number(m[1]);
    if (index > 50) continue;
    rows.set(index, { ...(rows.get(index) ?? {}), [m[2]]: value });
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row)
    .filter((row) => Object.values(row).some((v) => v.trim() !== ""));
}
