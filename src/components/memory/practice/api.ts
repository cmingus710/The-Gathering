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

export const startSession = (req: StartRequest) => post<Session>("/api/memory/sessions", req);

export const sessionHint = <T,>(id: string, body: Record<string, unknown> = {}) => post<T>(`/api/memory/sessions/${id}`, { action: "hint", ...body });

/** Licensed versions also return the fetched verses (shown unchanged), their copyright, and the FUMS id to report. */
export type RevealResponse = { status: string; reference: string; text: string | null; verses?: Verse[]; copyright?: string | null; fums_id?: string | null };

export const sessionReveal = (id: string) => post<RevealResponse>(`/api/memory/sessions/${id}`, { action: "reveal" });

export const sessionSubmit = (id: string, payload: Record<string, unknown>) => post<SubmitResult>(`/api/memory/sessions/${id}`, { action: "submit", ...payload });

export function failureMessage(r: SendResponse<unknown>): string {
  switch (r.kind) {
    case "signed_out":
      return "Your session has ended. Sign in again to continue.";
    case "expired":
      return "This activity has expired. Start it again.";
    case "conflict":
      return "This verse changed or was removed. Go back to My Verses.";
    case "error":
      return r.message;
    default:
      return "";
  }
}
