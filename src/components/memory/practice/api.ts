import { trackFums } from "@/components/bible/fums";
import { createDisplayEvents } from "@/lib/memory/fums-events";
import { toSendResponse, type SendResponse } from "@/lib/memory/submit";
import type { Verse } from "@/lib/bible/types";
import type { Session, SubmitResult } from "@/lib/memory/types";

/**
 * Browser calls to /api/memory. Answers travel only to our own server
 * (never to analytics or logs); responses are private and uncached.
 */
async function post<T>(url: string, body: unknown): Promise<SendResponse<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
    return await toSendResponse<T>(res);
  } catch {
    return { kind: "error", retryable: true, message: "The connection was interrupted." };
  }
}

export type StartRequest = {
  card_id: string;
  activity: Session["activity"];
  difficulty: Session["difficulty"];
  segment: number;
  options?: { direction?: "ref_to_text" | "text_to_ref"; ignore_case?: boolean; ignore_punctuation?: boolean; short?: boolean };
};

/** FUMS display events for licensed practice: one per activity (see src/lib/memory/fums-events.ts). */
export const displayEvents = createDisplayEvents(trackFums);

/** A hint, reveal, or checked result puts licensed text on screen. */
function shown<T>(id: string, r: SendResponse<T>): SendResponse<T> {
  if (r.kind === "ok") displayEvents.shown(id);
  return r;
}

export const startSession = (req: StartRequest) => post<Session>("/api/memory/sessions", req);

export const sessionHint = async <T,>(id: string, body: Record<string, unknown> = {}) => shown(id, await post<T>(`/api/memory/sessions/${id}`, { action: "hint", ...body }));

/** Licensed versions also return the fetched verses (shown unchanged), their copyright, and the FUMS id to report. */
export type RevealResponse = { status: string; reference: string; text: string | null; verses?: Verse[]; copyright?: string | null; fums_id?: string | null };

export const sessionReveal = async (id: string) => shown(id, await post<RevealResponse>(`/api/memory/sessions/${id}`, { action: "reveal" }));

export const sessionSubmit = async (id: string, payload: Record<string, unknown>) =>
  shown(id, await post<SubmitResult>(`/api/memory/sessions/${id}`, { action: "submit", ...payload }));

export function failureMessage(r: SendResponse<unknown>): string {
  switch (r.kind) {
    case "signed_out":
      return "Your session has ended. Sign in again to continue.";
    case "expired":
      return "This activity has expired. Start it again.";
    case "conflict":
      return r.message ?? "This verse changed or was removed. Go back to My Verses.";
    case "error":
      return r.message;
    default:
      return "";
  }
}
