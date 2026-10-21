"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { AutosaveController, type AutosaveState, type SaveResponse } from "@/lib/journal/autosave";
import { clearDraft, draftKey, readDraft, reconcileDraft, workbookStatusLabel, writeDraft } from "@/lib/media/workbook";

type Saved = { body: string; version: number; updated_at: string | null };

type Props = {
  /** The signed-in member (drafts on this device are kept per member). */
  userId: string;
  itemId: string;
  /** Block id, or "note". */
  slot: string;
  /** PUT endpoint for autosave. */
  url: string;
  initial: Saved | null;
  label: string;
  labelHidden?: boolean;
  placeholder?: string;
  rows?: number;
};

function toResponse(status: number, data: Record<string, unknown>): SaveResponse {
  if (status === 200) return { kind: "saved", version: Number(data.version), updatedAt: String(data.updated_at ?? "") };
  if (status === 409) {
    const c = (data.current ?? {}) as { body?: string; version?: number; updated_at?: string | null };
    return { kind: "conflict", current: { title: "", body: c.body ?? "", version: Number(c.version ?? 0), updatedAt: String(c.updated_at ?? "") } };
  }
  if (status === 401) return { kind: "signed_out" };
  const message = typeof data.error === "string" ? data.error : "That couldn't be saved.";
  return { kind: "error", retryable: status === 429 || status >= 500, message };
}

/**
 * A private answer or note that saves as the member types (the journal's
 * autosave controller: debounced, one save in flight, version-checked,
 * retried with backoff). Until the server confirms the text, a copy is kept
 * on this device (localStorage, keyed by member, lesson, and block) and
 * removed once it is saved. Text saved newer elsewhere is never overwritten
 * without the member choosing.
 */
export function WorkbookText({ userId, itemId, slot, url, initial, label, labelHidden, placeholder, rows = 5 }: Props) {
  const key = draftKey(userId, itemId, slot);
  const fieldId = `wb-${slot}`;
  const [text, setText] = useState(initial?.body ?? "");
  const [state, setState] = useState<AutosaveState | null>(null);
  const [deviceCopy, setDeviceCopy] = useState<string | null>(null);
  const [controller] = useState(
    () =>
      new AutosaveController({
        initial: { title: "", body: initial?.body ?? "", version: initial?.version ?? 0, updatedAt: initial?.updated_at ?? null },
        onState: (s) => {
          setState(s);
        },
        save: async (req) => {
          try {
            const res = await fetch(url, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ body: req.body, base_version: req.baseVersion, force: req.force }),
              cache: "no-store",
              credentials: "same-origin",
            });
            const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            return toResponse(res.status, data);
          } catch {
            return { kind: "error", retryable: true, message: "The connection was interrupted." };
          }
        },
      }),
  );

  // Keep (or drop) the on-device copy whenever the saved state changes
  // (not before the first change: the copy from an earlier visit is read below).
  useEffect(() => {
    if (!state) return;
    if (controller.dirty) writeDraft(key, { text: controller.text.body, base: state.version, at: Date.now() });
    else clearDraft(key);
  }, [state, controller, key]);

  // A copy left on this device by an earlier visit.
  useEffect(() => {
    const decision = reconcileDraft({ body: initial?.body ?? "", version: initial?.version ?? 0 }, readDraft(key));
    if (decision.kind === "restore") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring browser-only storage after hydration
      setText(decision.text);
      controller.edit({ title: "", body: decision.text });
    } else if (decision.kind === "conflict") {
      setDeviceCopy(decision.text);
    } else {
      clearDraft(key);
    }
  }, [controller, initial?.body, initial?.version, key]);

  useEffect(() => {
    const online = () => controller.resume();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
      controller.dispose();
    };
  }, [controller]);

  const edit = (value: string) => {
    setText(value);
    controller.edit({ title: "", body: value });
    writeDraft(key, { text: value, base: controller.current.version, at: Date.now() });
  };

  const s = state ?? controller.current;
  const blank = !initial && !text && s.status === "saved";
  const failedHard = s.status === "failed" && s.attempt === 0;
  const icon =
    s.status === "saved" ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
    : s.status === "saving" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    : s.status === "unsaved" ? <CircleDashed className="size-4" aria-hidden="true" />
    : <AlertTriangle className="size-4 text-danger" aria-hidden="true" />;

  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className={labelHidden ? "sr-only" : "block font-semibold"}>
        {label}
      </label>

      {deviceCopy !== null ? (
        <div className="rounded-card border border-primary bg-primary-soft p-3 text-meta">
          <p className="font-semibold">This device has text that wasn&apos;t saved, and the saved answer changed since.</p>
          <p className="text-text-secondary">Choose which to keep. Nothing is lost until you choose.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="font-semibold">On this device</p>
              <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-tile border border-border bg-surface p-2">{deviceCopy}</div>
            </div>
            <div>
              <p className="font-semibold">Saved</p>
              <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-tile border border-border bg-surface p-2">{text || "(empty)"}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                edit(deviceCopy);
                setDeviceCopy(null);
              }}
            >
              Use this device&apos;s text
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                clearDraft(key);
                setDeviceCopy(null);
              }}
            >
              Keep the saved text
            </Button>
          </div>
        </div>
      ) : null}

      {s.status === "conflict" && s.conflict ? (
        <div className="rounded-card border border-primary bg-primary-soft p-3 text-meta" role="alert">
          <p className="font-semibold">This was saved in another tab or on another device while you were writing.</p>
          <p className="text-text-secondary">Choose what to keep. Nothing is lost until you choose.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="font-semibold">Yours (on this page)</p>
              <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-tile border border-border bg-surface p-2">{text || "(empty)"}</div>
            </div>
            <div>
              <p className="font-semibold">Saved elsewhere</p>
              <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-tile border border-border bg-surface p-2">{s.conflict.body || "(empty)"}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => controller.keepMine()}>
              Keep mine
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const saved = controller.useSaved();
                if (saved) setText(saved.body);
              }}
            >
              Use the saved one
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const both = `${text.trimEnd()}\n\n---\n\n${s.conflict!.body.trim()}`.slice(0, 10_000);
                setText(both);
                controller.edit({ title: "", body: both });
                controller.keepMine();
              }}
            >
              Keep both
            </Button>
          </div>
        </div>
      ) : null}

      <textarea
        id={fieldId}
        value={text}
        rows={rows}
        maxLength={10_000}
        placeholder={placeholder ?? "Write your answer. Only you can see it."}
        onChange={(e) => edit(e.target.value)}
        onBlur={() => void controller.flush()}
        aria-describedby={`${fieldId}-status`}
        className="block w-full rounded-control border border-border-strong bg-surface px-4 py-3 text-base leading-relaxed focus-visible:outline-3 focus-visible:outline-primary"
      />
      <div className="flex flex-wrap items-center gap-2">
        <p id={`${fieldId}-status`} role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-meta", s.status === "saved" ? "text-text-secondary" : "font-semibold text-text")}>
          {blank ? (
            <span>Saves as you type.</span>
          ) : (
            <>
              {icon}
              {failedHard ? `Couldn't save — your text is kept here. ${s.message ?? ""}` : workbookStatusLabel(s)}
            </>
          )}
        </p>
        {["failed", "offline", "signed_out"].includes(s.status) ? (
          <Button size="sm" variant="ghost" onClick={() => controller.resume()} icon={<RotateCcw className="size-4" aria-hidden="true" />}>
            Retry now
          </Button>
        ) : null}
      </div>
      {s.status === "signed_out" ? (
        <p className="text-meta">
          <a href="/sign-in" target="_blank" rel="noopener" className="font-semibold text-primary underline">
            Sign in in a new tab
          </a>
          , then choose Retry now. Don&apos;t close this page until it says Saved.
        </p>
      ) : null}
    </div>
  );
}
