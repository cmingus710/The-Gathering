import { z } from "zod";

/** Trimmed optional text; "" becomes null. */
const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => v || null);

const phone = z
  .string()
  .trim()
  .max(40, "Use 40 characters or fewer.")
  .refine((v) => v === "" || /^[0-9+().\-\s]{7,40}$/.test(v), "Enter a phone number using digits, spaces, and + ( ) - only.")
  .transform((v) => v || null);

const contactEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email address is too long.")
  .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address, like name@example.com.")
  .transform((v) => v || null);

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const birthdayPart = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)));

const nameFields = {
  firstName: z.string().trim().min(1, "Enter your first name.").max(60, "Use 60 characters or fewer."),
  lastName: text(60, "Last name"),
  preferredName: text(60, "Preferred name"),
};

const detailFields = {
  phone,
  contactEmail,
  streetAddress: text(120, "Street address"),
  city: text(80, "City"),
  stateRegion: text(40, "State"),
  postalCode: text(20, "Postal code"),
  bio: text(500, "About you"),
  birthdayMonth: birthdayPart,
  birthdayDay: birthdayPart,
};

function checkBirthday(d: { birthdayMonth: number | null; birthdayDay: number | null }, ctx: z.RefinementCtx) {
  const { birthdayMonth: m, birthdayDay: day } = d;
  if (m === null && day === null) return;
  if (m === null || !Number.isInteger(m) || m < 1 || m > 12) {
    ctx.addIssue({ code: "custom", path: ["birthdayMonth"], message: "Choose a month, or clear both birthday fields." });
    return;
  }
  if (day === null || !Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[m - 1]) {
    ctx.addIssue({ code: "custom", path: ["birthdayDay"], message: "Choose a valid day for that month." });
  }
}

const uuid = z.uuid();

/** A member editing their own profile. */
export const memberProfileSchema = z
  .object({
    ...nameFields,
    ...detailFields,
    interests: z.array(uuid).max(50, "Choose fewer interests."),
  })
  .superRefine(checkBirthday);

export type MemberProfileInput = z.infer<typeof memberProfileSchema>;

/** A membership administrator correcting someone's profile. */
export const adminProfileSchema = z
  .object({
    userId: uuid,
    firstName: z.string().trim().max(60, "Use 60 characters or fewer.").transform((v) => v || null),
    lastName: text(60, "Last name"),
    preferredName: text(60, "Preferred name"),
    ...detailFields,
    removePhoto: z.boolean(),
  })
  .superRefine(checkBirthday);

export const PRIVACY_KEYS = [
  "directory_listed",
  "show_photo",
  "show_city_state",
  "show_ministry_interests",
  "show_household",
  "show_contact_email",
  "show_phone",
  "show_street_address",
  "show_birthday",
] as const;

export type PrivacyKey = (typeof PRIVACY_KEYS)[number];
export type PrivacySettings = Record<PrivacyKey, boolean>;

/** Privacy form: an unchecked checkbox is simply absent from the form data. */
export function parsePrivacy(formData: FormData): PrivacySettings {
  return Object.fromEntries(PRIVACY_KEYS.map((k) => [k, formData.get(k) === "on"])) as PrivacySettings;
}

export const interestLabelSchema = z.object({
  label: z.string().trim().min(1, "Enter a name.").max(60, "Use 60 characters or fewer."),
  sortOrder: z
    .string()
    .trim()
    .transform((v) => (v === "" ? 0 : Number(v)))
    .pipe(z.number().int("Use a whole number.").min(0, "Use 0 or more.").max(10000, "Use 10000 or less.")),
});
