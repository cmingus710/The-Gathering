import { audienceLabel, KIND_LABEL, STATE_LABEL } from "./format";
import type { AssetRow, Attachment, Audience, ItemKind, ItemState, ProviderStatus, VideoPublishing } from "./types";

/**
 * Plain-language reasons why members can or can't see a video or a piece of
 * content, for administrators. Derived only from what the database reports;
 * nothing here changes visibility.
 */
export type Reason = { tone: "success" | "info" | "warning" | "danger"; title: string; detail?: string };

type When = (iso: string) => string;

export function providerReason(status: ProviderStatus | null | undefined, provider: string | null): Reason | null {
  const name = provider === "vimeo" ? "Vimeo" : "YouTube";
  switch (status) {
    case "unavailable":
      return { tone: "danger", title: `${name} reports this video is unavailable`, detail: "It may have been removed or made private. Members see an “Open in” link instead of a player." };
    case "not_embeddable":
      return {
        tone: "danger",
        title: `${name} won't play this video inside other sites`,
        detail: "The owner turned off embedding, or it's private. Members see an “Open in” link instead of a player.",
      };
    case "error":
      return { tone: "info", title: `${name} couldn't be checked`, detail: "The last check didn't get an answer. Try “Check again” later." };
    default:
      return null;
  }
}

function itemStateReason(state: ItemState, publishAt: string | null, expiresAt: string | null, when: When, noun: string): Reason {
  switch (state) {
    case "live":
      return { tone: "success", title: `Published${publishAt ? ` ${when(publishAt)}` : ""}`, detail: expiresAt ? `Hides ${when(expiresAt)}.` : undefined };
    case "scheduled":
      return { tone: "info", title: `Scheduled: goes live ${publishAt ? when(publishAt) : "later"}`, detail: `Members can't see the ${noun} until then.` };
    case "draft":
      return { tone: "warning", title: "Draft (not published)", detail: `Members can't see the ${noun} until a publisher publishes it.` };
    case "expired":
      return { tone: "warning", title: `Expired${expiresAt ? ` ${when(expiresAt)}` : ""}`, detail: `It's hidden from members now. Change or clear the expiry to show it again.` };
    case "archived":
      return { tone: "info", title: "Archived", detail: "Hidden everywhere. Restore it to publish it again." };
  }
}

function audienceReason(audience: Audience, groupName: string | null): Reason | null {
  if (audience === "group") return { tone: "info", title: `Restricted: ${audienceLabel(audience, groupName)}`, detail: "Only that group's current members can find it." };
  if (audience === "public") return { tone: "info", title: "Public", detail: "Anyone can see it, including people who aren't signed in." };
  return null;
}

/** Why a piece of content is or isn't visible (the editor's "Who can see it now" panel). */
export function itemReasons(
  item: { kind: ItemKind; state: ItemState; audience: Audience; group_name: string | null; publish_at: string | null; expires_at: string | null; attachments: Attachment[] },
  when: When,
): Reason[] {
  const noun = item.kind === "video" ? "video" : KIND_LABEL[item.kind].toLowerCase();
  const reasons: Reason[] = [itemStateReason(item.state, item.publish_at, item.expires_at, when, noun)];
  const aud = audienceReason(item.audience, item.group_name);
  if (aud) reasons.push(aud);
  const videos = item.attachments.filter((a) => a.role === "video");
  if (item.kind === "video" && !videos.length) reasons.push({ tone: "danger", title: "No video chosen", detail: "Choose the video before publishing." });
  for (const v of videos) {
    if (v.status !== "ready") reasons.push({ tone: "warning", title: `“${v.title}” isn't ready`, detail: "It's still processing or failed. Members won't see it." });
    else if (v.unavailable) reasons.push({ ...providerReason("not_embeddable", v.provider)!, title: `“${v.title}” can't play here` });
  }
  if (item.kind === "video") {
    reasons.push({ tone: "info", title: "Listed in Videos and search when published", detail: "Members who can see it find it under Teaching & media → Videos." });
  } else if (videos.length) {
    reasons.push({
      tone: "info",
      title: "Its videos play inside this page",
      detail: "Attached videos follow this page's audience and aren't listed in Videos or search on their own. Publish a video separately to list it.",
    });
  }
  return reasons;
}

/** Why a library video is or isn't reaching members (the media file page). */
export function videoAssetReasons(a: Pick<AssetRow, "status" | "provider" | "provider_status" | "publishing">, when: When): Reason[] {
  const reasons: Reason[] = [];
  if (a.status === "uploading" || a.status === "processing") reasons.push({ tone: "warning", title: "Still processing", detail: "It can be used once it's ready." });
  if (a.status === "failed") reasons.push({ tone: "danger", title: "Processing failed", detail: "Upload it again." });
  if (a.status === "removed") reasons.push({ tone: "info", title: "Removed from the library" });
  const provider = providerReason(a.provider_status, a.provider);
  if (provider) reasons.push(provider);
  const p: VideoPublishing = a.publishing ?? { standalone: [], attached: [], albums: [], blocks: 0 };
  if (!p.standalone.length && !p.attached.length && !p.albums.length && !p.blocks) {
    reasons.push({
      tone: "warning",
      title: "Library file only: members can't find it",
      detail: "A library file is never shown on its own. Publish it as a video for members, attach it to a lesson, devotional, or reading, or add it to a Media gallery album.",
    });
    return reasons;
  }
  for (const s of p.standalone) {
    const r = itemStateReason(s.state, s.publish_at, s.expires_at, when, "video");
    reasons.push({ ...r, title: `Video page: ${r.title}`, detail: [r.detail, s.audience === "group" ? `Only ${s.group_name ?? "one group"} can see it.` : null].filter(Boolean).join(" ") || undefined });
  }
  if (p.attached.length) {
    const live = p.attached.filter((x) => x.state === "live");
    reasons.push({
      tone: live.length ? "success" : "warning",
      title: live.length
        ? `Shown on ${live.length} published ${live.length === 1 ? "page" : "pages"}`
        : `Attached to ${p.attached.length} ${p.attached.length === 1 ? "page" : "pages"} that ${p.attached.length === 1 ? "isn't" : "aren't"} published`,
      detail: p.attached.map((x) => `${x.title} (${KIND_LABEL[x.kind]}, ${STATE_LABEL[x.state].toLowerCase()})`).join("; "),
    });
    if (!p.standalone.length) {
      reasons.push({ tone: "info", title: "Not listed in Videos or search", detail: "Attached videos play inside their pages only. Publish it as a video to list it." });
    }
  }
  if (p.blocks) reasons.push({ tone: "info", title: `Used in ${p.blocks} lesson workbook ${p.blocks === 1 ? "block" : "blocks"}` });
  for (const al of p.albums) {
    const shown = al.status === "approved" && al.album_status === "published";
    reasons.push({
      tone: shown ? "success" : "warning",
      title: `Media gallery: ${al.title}`,
      detail: shown ? `Shown in the album (${audienceLabel(al.audience, al.group_name)}).` : al.status === "pending" ? "Waiting for review in the album." : al.album_status !== "published" ? "The album isn't published." : "Hidden in the album.",
    });
  }
  return reasons;
}
