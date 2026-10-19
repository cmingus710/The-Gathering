import { z } from "zod";
import { REMINDER_CHOICES } from "./format";

/**
 * Event form parsing. Produces the JSON payload for events_admin_save().
 * The database re-validates everything with constraints.
 */

/**
 * Online meeting links: https only, a real host name, no embedded
 * credentials, no IP literals or local hosts.
 */
export function validMeetingUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  if (/^\d+(\.\d+){3}$/.test(host) || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return null;
  if (url.href.length > 500) return null;
  return url.href;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((v) => (v === "" ? null : v));

function minutesBetween(startDate: string, startTime: string, endDate: string, endTime: string): number {
  const a = Date.parse(`${startDate}T${startTime}:00Z`);
  const b = Date.parse(`${endDate}T${endTime}:00Z`);
  return Math.round((b - a) / 60000);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title.").max(160, "Keep the title to 160 characters."),
    description: z.string().max(10000, "Keep the description to 10,000 characters.").default(""),
    categoryId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
    audience: z.enum(["public", "members", "group"], { message: "Choose who can see this event." }),
    groupId: z.union([z.uuid(), z.literal("")]).default("").transform((v) => v || null),
    timezone: z.string().min(1, "Choose a time zone."),
    allDay: z.boolean(),
    startDate: z.string().regex(DATE, "Enter the start date."),
    startTime: z.string(),
    endDate: z.string(),
    endTime: z.string(),
    locationName: text(200, "Location"),
    locationAddress: text(300, "Address"),
    onlineUrl: z.string().trim(),
    organizerName: text(120, "Organizer"),
    rsvpEnabled: z.boolean(),
    capacity: z.string().trim(),
    waitlistEnabled: z.boolean(),
    rsvpCloseHours: z.string().trim(),
    cancellationInstructions: text(1000, "Cancellation instructions"),
    reminders: z.array(z.coerce.number()).max(3, "Choose up to three reminders."),
    recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
    interval: z.string().trim(),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)),
    monthlyMode: z.enum(["day", "ordinal"]).optional(),
    monthOrdinal: z.string().optional(),
    endMode: z.enum(["until", "count"]).optional(),
    untilDate: z.string().optional(),
    occurrenceLimit: z.string().optional(),
    coverAlt: text(300, "Image description"),
    hasCover: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.audience === "group" && !v.groupId) issue("groupId", "Choose the group that can see this event.");
    if (v.onlineUrl && !validMeetingUrl(v.onlineUrl)) {
      issue("onlineUrl", "Enter a full https:// meeting link (for example https://zoom.us/j/…).");
    }
    if (v.allDay) {
      const end = v.endDate || v.startDate;
      if (!DATE.test(end)) issue("endDate", "Enter the end date.");
      else {
        const days = daysBetween(v.startDate, end) + 1;
        if (days < 1) issue("endDate", "The end date can't be before the start date.");
        if (days > 14) issue("endDate", "All-day events can last up to 14 days.");
      }
    } else {
      if (!TIME.test(v.startTime)) issue("startTime", "Enter the start time.");
      if (!TIME.test(v.endTime)) issue("endTime", "Enter the end time.");
      const endDate = v.endDate || v.startDate;
      if (TIME.test(v.startTime) && TIME.test(v.endTime) && DATE.test(endDate)) {
        const mins = minutesBetween(v.startDate, v.startTime, endDate, v.endTime);
        if (mins < 5) issue("endTime", "The event must end at least 5 minutes after it starts.");
        if (mins > 10080) issue("endDate", "Timed events can last up to 7 days.");
      }
    }
    if (v.rsvpEnabled) {
      if (v.capacity && !/^\d{1,5}$/.test(v.capacity)) issue("capacity", "Enter a whole number of places, or leave it blank.");
      else if (v.capacity && (Number(v.capacity) < 1 || Number(v.capacity) > 10000)) issue("capacity", "Capacity must be between 1 and 10,000.");
      if (v.waitlistEnabled && !v.capacity) issue("waitlistEnabled", "A waitlist needs a capacity.");
      if (v.rsvpCloseHours && !/^\d{1,4}$/.test(v.rsvpCloseHours)) issue("rsvpCloseHours", "Enter a whole number of hours.");
      else if (v.rsvpCloseHours && Number(v.rsvpCloseHours) > 8760) issue("rsvpCloseHours", "Use 8760 hours (one year) or less.");
    }
    if (v.reminders.some((m) => !REMINDER_CHOICES.some((c) => c.minutes === m))) issue("reminders", "Choose reminders from the list.");
    if (v.recurrence !== "none") {
      if (!/^\d{1,2}$/.test(v.interval) || Number(v.interval) < 1 || Number(v.interval) > 12) issue("interval", "Repeat every 1 to 12.");
      if (v.recurrence === "weekly" && v.weekdays.length === 0) issue("weekdays", "Choose at least one day of the week.");
      if (v.recurrence === "monthly" && !v.monthlyMode) issue("monthlyMode", "Choose how the event repeats each month.");
      if (v.recurrence === "monthly" && v.monthlyMode === "ordinal" && !["1", "2", "3", "4", "-1"].includes(v.monthOrdinal ?? "")) {
        issue("monthOrdinal", "Choose which week of the month.");
      }
      if (v.endMode === "count") {
        if (!/^\d{1,3}$/.test(v.occurrenceLimit ?? "") || Number(v.occurrenceLimit) < 1 || Number(v.occurrenceLimit) > 200) {
          issue("occurrenceLimit", "Choose between 1 and 200 dates.");
        }
      } else if (!DATE.test(v.untilDate ?? "")) {
        issue("untilDate", "Choose when the series ends.");
      } else if (v.untilDate! < v.startDate) {
        issue("untilDate", "The series can't end before it starts.");
      } else if (daysBetween(v.startDate, v.untilDate!) > 731) {
        issue("untilDate", "A series can run for up to two years.");
      }
    }
    if (v.hasCover && !v.coverAlt) issue("coverAlt", "Describe the image for people who can't see it.");
  });

export type EventFormInput = z.input<typeof eventFormSchema>;

export function eventFormFromData(formData: FormData): EventFormInput {
  const s = (k: string) => String(formData.get(k) ?? "");
  return {
    title: s("title"),
    description: s("description"),
    categoryId: s("categoryId"),
    audience: s("audience") as "public" | "members" | "group",
    groupId: s("groupId"),
    timezone: s("timezone"),
    allDay: formData.get("allDay") === "on",
    startDate: s("startDate"),
    startTime: s("startTime"),
    endDate: s("endDate"),
    endTime: s("endTime"),
    locationName: s("locationName"),
    locationAddress: s("locationAddress"),
    onlineUrl: s("onlineUrl"),
    organizerName: s("organizerName"),
    rsvpEnabled: formData.get("rsvpEnabled") === "on",
    capacity: s("capacity"),
    waitlistEnabled: formData.get("waitlistEnabled") === "on",
    rsvpCloseHours: s("rsvpCloseHours"),
    cancellationInstructions: s("cancellationInstructions"),
    reminders: formData.getAll("reminders").map(String),
    recurrence: (s("recurrence") || "none") as "none",
    interval: s("interval") || "1",
    weekdays: formData.getAll("weekdays").map(String),
    monthlyMode: (s("monthlyMode") || undefined) as "day" | undefined,
    monthOrdinal: s("monthOrdinal") || undefined,
    endMode: (s("endMode") || undefined) as "until" | undefined,
    untilDate: s("untilDate") || undefined,
    occurrenceLimit: s("occurrenceLimit") || undefined,
    coverAlt: s("coverAlt"),
    hasCover: formData.get("hasCover") === "true" || (formData.get("cover") instanceof File && (formData.get("cover") as File).size > 0),
  } as unknown as EventFormInput;
}

/** Payload for events_admin_save (database column names). */
export function toSeriesPayload(v: z.output<typeof eventFormSchema>) {
  const recurring = v.recurrence !== "none";
  const endDate = v.endDate || v.startDate;
  return {
    title: v.title,
    description: v.description,
    category_id: v.categoryId,
    audience: v.audience,
    group_id: v.audience === "group" ? v.groupId : null,
    timezone: v.timezone,
    all_day: v.allDay,
    start_date: v.startDate,
    start_time: v.allDay ? null : v.startTime,
    duration_minutes: v.allDay ? null : minutesBetween(v.startDate, v.startTime, endDate, v.endTime),
    day_count: v.allDay ? daysBetween(v.startDate, endDate) + 1 : null,
    location_name: v.locationName,
    location_address: v.locationAddress,
    online_url: v.onlineUrl ? validMeetingUrl(v.onlineUrl) : null,
    organizer_name: v.organizerName,
    rsvp_enabled: v.rsvpEnabled,
    capacity: v.rsvpEnabled && v.capacity ? Number(v.capacity) : null,
    waitlist_enabled: v.rsvpEnabled && v.waitlistEnabled,
    rsvp_close_minutes: v.rsvpEnabled && v.rsvpCloseHours ? Number(v.rsvpCloseHours) * 60 : null,
    cancellation_instructions: v.cancellationInstructions,
    reminder_minutes: [...new Set(v.reminders)].sort((a, b) => b - a),
    recurrence: v.recurrence,
    interval_count: recurring ? Number(v.interval) : 1,
    weekdays: v.recurrence === "weekly" ? [...new Set(v.weekdays)].sort() : null,
    monthly_mode: v.recurrence === "monthly" ? v.monthlyMode : null,
    month_ordinal: v.recurrence === "monthly" && v.monthlyMode === "ordinal" ? Number(v.monthOrdinal) : null,
    until_date: recurring && v.endMode !== "count" ? v.untilDate : null,
    occurrence_limit: recurring && v.endMode === "count" ? Number(v.occurrenceLimit) : null,
    cover_alt: v.coverAlt,
  };
}
