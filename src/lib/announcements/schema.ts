import { z } from "zod";
import { zonedLocalToUtc } from "@/lib/time";

export const ANNOUNCEMENT_INTENTS = ["save_draft", "schedule", "publish_now", "update"] as const;
export type AnnouncementIntent = (typeof ANNOUNCEMENT_INTENTS)[number];

const base = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(160, "Use 160 characters or fewer."),
  body: z.string().max(20000, "The announcement is too long (20,000 characters maximum)."),
  visibility: z.enum(["public", "members"], { error: "Choose who can see this announcement." }),
  pinned: z.boolean(),
  publishAt: z.string().trim(),
  expiresAt: z.string().trim(),
  imageAlt: z.string().trim().max(300, "Use 300 characters or fewer."),
  intent: z.enum(ANNOUNCEMENT_INTENTS),
});

export type AnnouncementInput = z.infer<typeof base>;

export type AnnouncementWrite = {
  title: string;
  body: string;
  visibility: "public" | "members";
  pinned: boolean;
  status?: "draft" | "scheduled" | "published";
  publish_at: string | null;
  expires_at: string | null;
  image_alt: string | null;
};

/**
 * Validates form input and converts local church-time dates to UTC.
 * `hasImage` tells the validator whether an image will be attached.
 */
export function parseAnnouncementForm(
  input: AnnouncementInput,
  opts: { timeZone: string; now?: Date; hasImage: boolean; currentStatus?: string },
): { ok: true; data: AnnouncementWrite } | { ok: false; error: z.ZodError } {
  const now = opts.now ?? new Date();
  const schema = base.superRefine((d, ctx) => {
    const publishAt = d.publishAt ? zonedLocalToUtc(d.publishAt, opts.timeZone) : null;
    const expiresAt = d.expiresAt ? zonedLocalToUtc(d.expiresAt, opts.timeZone) : null;
    if (d.publishAt && !publishAt) ctx.addIssue({ code: "custom", path: ["publishAt"], message: "Enter a valid date and time." });
    if (d.expiresAt && !expiresAt) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Enter a valid date and time." });
    if (d.intent === "schedule") {
      if (!d.publishAt) ctx.addIssue({ code: "custom", path: ["publishAt"], message: "Choose when this should be published." });
      else if (publishAt && publishAt <= now)
        ctx.addIssue({ code: "custom", path: ["publishAt"], message: "Choose a future time, or use Publish now." });
    }
    const effectivePublish = d.intent === "publish_now" ? now : publishAt;
    if (expiresAt && effectivePublish && expiresAt <= effectivePublish) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "The expiration must be after the publish time." });
    }
    if (expiresAt && expiresAt <= now && d.intent !== "save_draft") {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "The expiration must be in the future." });
    }
    if (opts.hasImage && !d.imageAlt) {
      ctx.addIssue({ code: "custom", path: ["imageAlt"], message: "Describe the image for people using screen readers." });
    }
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error };
  const d = parsed.data;
  const publishAt = d.publishAt ? zonedLocalToUtc(d.publishAt, opts.timeZone) : null;
  const expiresAt = d.expiresAt ? zonedLocalToUtc(d.expiresAt, opts.timeZone) : null;

  const write: AnnouncementWrite = {
    title: d.title,
    body: d.body,
    visibility: d.visibility,
    pinned: d.pinned,
    publish_at: publishAt?.toISOString() ?? null,
    expires_at: expiresAt?.toISOString() ?? null,
    image_alt: opts.hasImage ? d.imageAlt : null,
  };
  if (d.intent === "save_draft") write.status = "draft";
  if (d.intent === "schedule") write.status = "scheduled";
  if (d.intent === "publish_now") {
    write.status = "published";
    write.publish_at = now.toISOString();
  }
  // "update" keeps the current status (used for live/scheduled edits).
  if (d.intent === "update" && (opts.currentStatus === "scheduled" || opts.currentStatus === "published") && !write.publish_at) {
    return {
      ok: false,
      error: new z.ZodError([{ code: "custom", path: ["publishAt"], message: "A published or scheduled announcement needs a publish time.", input: "" }]),
    };
  }
  return { ok: true, data: write };
}
