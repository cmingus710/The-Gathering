import type { Attachment, VideoInfo } from "./types";

/** An item's video attachment as the shared player's input. */
export function attachmentVideo(a: Attachment): VideoInfo {
  return {
    asset_id: a.asset_id,
    kind: a.kind === "external_video" ? "external_video" : "video",
    title: a.title,
    provider: a.provider,
    provider_ref: a.provider_ref,
    provider_hash: a.provider_hash,
    duration_seconds: a.duration_seconds,
    width: a.width,
    height: a.height,
    has_thumb: a.has_thumb ?? (a.kind === "external_video" && a.provider === "youtube"),
    unavailable: a.unavailable ?? false,
    attribution: a.attribution,
    captions: a.captions,
  };
}

/** Playable video attachments in the order the administrator set. */
export function videoAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.filter((a) => a.role === "video" && (a.kind === "video" || a.kind === "external_video"));
}

/** The caption shown under a video: the administrator's note, unless it only repeats the file title. */
export function videoCaption(a: Pick<Attachment, "caption" | "title">): string | null {
  const c = a.caption?.trim();
  return c && c !== a.title ? c : null;
}
