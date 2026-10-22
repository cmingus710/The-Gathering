"use client";

import { AlertTriangle, Bold, CheckCircle2, CircleDashed, CloudOff, Italic, List, Loader2, Quote, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { renderCommunityText } from "@/lib/community/format";
import { AutosaveController, statusLabel, type AutosaveState, type SaveResponse } from "@/lib/journal/autosave";

export type EditorEntry = { id: string; title: string; body: string; version: number; updated_at: string };

type Props = {
  entry: EditorEntry | null;
  /** For a new entry: what it links to (sent with the first save). */
  link?: Record<string, string | number | null> | null;
  placeholder?: string;
  /**
   * Embedded in another page (the church reading page): the address bar stays
   * on that page after the first save, and a link opens the entry in My Journal.
   */
  inline?: boolean;
};

async function call(url: string, method: "POST" | "PUT", body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

function toResponse(status: number, data: Record<string, unknown>): SaveResponse {
  if (status === 200) return { kind: "saved", version: Number(data.version), updatedAt: String(data.updated_at ?? "") };
  if (status === 409) {
    const c = data.current as { title: string; body: string; version: number; updated_at: string };
    return { kind: "conflict", current: { title: c.title, body: c.body, version: c.version, updatedAt: c.updated_at } };
  }
  if (status === 401) return { kind: "signed_out" };
  const message = typeof data.error === "string" ? data.error : "That couldn't be saved.";
  return { kind: "error", retryable: status === 429 || status >= 500, message };
}

/**
 * The journal editor. Text lives in memory only (never in browser storage);
 * the account copy is the only saved copy, and the status line says
 * "Saved" only after the server confirms the text on screen.
 */
export function JournalEditor({ entry, link, placeholder, inline = false }: Props) {
  const fieldId = useId();
  const [id, setId] = useState(entry?.id ?? null);
  // Mutable per-editor session (the saved entry's id once created, and the
  // key that makes the first save idempotent).
  const [session] = useState(() => ({ id: entry?.id ?? null, clientKey: crypto.randomUUID() }));
  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [state, setState] = useState<AutosaveState | null>(null);
  const [preview, setPreview] = useState(false);
  const [copyNote, setCopyNote] = useState<{ id: string } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const [controller] = useState(
    () =>
      new AutosaveController({
        initial: { title: entry?.title ?? "", body: entry?.body ?? "", version: entry?.version ?? 0, updatedAt: entry?.updated_at ?? null },
        onState: setState,
        save: async (req) => {
          try {
            if (!session.id) {
              const r = await call("/api/journal/entries", "POST", { client_key: session.clientKey, title: req.title, body: req.body, link: link ?? null });
              if (r.status === 200) {
                session.id = String(r.data.id);
                setId(session.id);
                if (!inline) window.history.replaceState(null, "", `/journal/${session.id}`);
              }
              return toResponse(r.status, r.data);
            }
            const r = await call(`/api/journal/entries/${session.id}`, "PUT", { title: req.title, body: req.body, base_version: req.baseVersion, force: req.force });
            return toResponse(r.status, r.data);
          } catch {
            return { kind: "error", retryable: true, message: "The connection was interrupted." };
          }
        },
      }),
  );

  useEffect(() => {
    const online = () => controller.resume();
    const offline = () => controller.flush();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeunload", beforeUnload);
      controller.dispose();
    };
  }, [controller]);

  const edit = useCallback(
    (t: string, b: string) => {
      setTitle(t);
      setBody(b);
      controller.edit({ title: t, body: b });
    },
    [controller],
  );

  /** Wraps the selection (or inserts at the cursor) with Markdown. */
  const format = (kind: "bold" | "italic" | "list" | "quote") => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = body.slice(s, e);
    let next = body;
    if (kind === "bold" || kind === "italic") {
      const mark = kind === "bold" ? "**" : "*";
      next = body.slice(0, s) + mark + (sel || "text") + mark + body.slice(e);
    } else {
      const prefix = kind === "list" ? "- " : "> ";
      const start = body.lastIndexOf("\n", s - 1) + 1;
      const lines = body.slice(start, e).split("\n").map((l) => (l.startsWith(prefix) ? l : prefix + l));
      next = body.slice(0, start) + lines.join("\n") + body.slice(e);
    }
    edit(title, next);
    requestAnimationFrame(() => el.focus());
  };

  const keepBoth = async () => {
    const mine = controller.text;
    const r = await call("/api/journal/entries", "POST", { client_key: crypto.randomUUID(), title: `${mine.title || "Untitled"} (my copy)`.slice(0, 200), body: mine.body, link: null });
    if (r.status !== 200) return;
    setCopyNote({ id: String(r.data.id) });
    const saved = controller.useSaved();
    if (saved) {
      setTitle(saved.title);
      setBody(saved.body);
    }
  };

  const s = state ?? controller.current;
  const icon =
    s.status === "saved" ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
    : s.status === "saving" || s.status === "retrying" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    : s.status === "offline" ? <CloudOff className="size-4" aria-hidden="true" />
    : s.status === "unsaved" ? <CircleDashed className="size-4" aria-hidden="true" />
    : <AlertTriangle className="size-4 text-danger" aria-hidden="true" />;
  const isNewAndEmpty = !id && !title && !body;

  return (
    <div
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void controller.flush();
        }
      }}
    >
      <div
        className={cn(
          "mb-3 flex flex-wrap items-center justify-between gap-2",
          !inline && "sticky top-[calc(var(--header-height,3.5rem))] z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur-sm",
        )}
      >
        <p className={cn("flex items-center gap-1.5 text-meta font-semibold", s.status === "saved" ? "text-text-secondary" : "text-text")} role="status" aria-live="polite">
          {isNewAndEmpty ? <span className="text-text-secondary">Start writing; it saves as you go.</span> : (
            <>
              {icon}
              {statusLabel(s)}
            </>
          )}
        </p>
        {["failed", "offline", "signed_out"].includes(s.status) ? (
          <Button size="sm" variant="secondary" onClick={() => controller.resume()} icon={<RotateCcw className="size-4" aria-hidden="true" />}>
            Retry
          </Button>
        ) : null}
        {inline && id ? (
          <Link href={`/journal/${id}`} className="inline-flex min-h-11 items-center text-meta font-semibold text-primary hover:underline">
            Open in My Journal
          </Link>
        ) : null}
      </div>

      {s.message && s.status !== "saved" ? (
        <div role="alert" className="mb-4 rounded-tile border border-danger bg-danger-soft px-4 py-3 text-meta">
          <p>{s.message}</p>
          {s.status === "signed_out" ? (
            <p className="mt-1">
              <a href="/sign-in?next=/journal" target="_blank" rel="noopener" className="font-semibold text-primary underline">
                Sign in in a new tab
              </a>
              , then come back and choose Retry. Don&apos;t close this page until it says Saved.
            </p>
          ) : null}
        </div>
      ) : null}

      {s.status === "conflict" && s.conflict ? (
        <div className="mb-4 rounded-card border border-primary bg-primary-soft p-4">
          <p className="font-semibold">This entry was saved somewhere else while you were writing.</p>
          <p className="text-meta text-text-secondary">Choose what to keep. Nothing is lost until you choose.</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-meta font-semibold">Show the other saved version</summary>
            <div className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-tile border border-border bg-surface p-3 text-meta">
              {s.conflict.title ? <p className="font-semibold">{s.conflict.title}</p> : null}
              {s.conflict.body}
            </div>
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => controller.keepMine()}>
              Keep mine
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const saved = controller.useSaved();
                if (saved) {
                  setTitle(saved.title);
                  setBody(saved.body);
                }
              }}
            >
              Use the other version
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void keepBoth()}>
              Keep both
            </Button>
          </div>
        </div>
      ) : null}
      {copyNote ? (
        <p className="mb-4 text-meta">
          Your text was saved as a separate entry.{" "}
          <Link href={`/journal/${copyNote.id}`} className="font-semibold text-primary hover:underline">
            Open your copy
          </Link>
        </p>
      ) : null}

      <label htmlFor={`${fieldId}-title`} className="sr-only">
        Title
      </label>
      <input
        id={`${fieldId}-title`}
        value={title}
        maxLength={200}
        placeholder="Title"
        onChange={(e) => edit(e.target.value, body)}
        onBlur={() => void controller.flush()}
        className="mb-3 block w-full rounded-control border border-border-strong bg-surface px-4 py-2.5 font-display text-xl font-semibold focus-visible:outline-3 focus-visible:outline-primary"
      />
      <div className="mb-2 flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
        <Button size="sm" variant="ghost" aria-label="Bold" onClick={() => format("bold")} disabled={preview} icon={<Bold className="size-4" aria-hidden="true" />}>
          <span className="sr-only">Bold</span>
        </Button>
        <Button size="sm" variant="ghost" aria-label="Italic" onClick={() => format("italic")} disabled={preview} icon={<Italic className="size-4" aria-hidden="true" />}>
          <span className="sr-only">Italic</span>
        </Button>
        <Button size="sm" variant="ghost" aria-label="Bulleted list" onClick={() => format("list")} disabled={preview} icon={<List className="size-4" aria-hidden="true" />}>
          <span className="sr-only">List</span>
        </Button>
        <Button size="sm" variant="ghost" aria-label="Quote" onClick={() => format("quote")} disabled={preview} icon={<Quote className="size-4" aria-hidden="true" />}>
          <span className="sr-only">Quote</span>
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant={preview ? "secondary" : "ghost"} aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          {preview ? "Edit" : "Preview"}
        </Button>
      </div>
      {preview ? (
        <div className="prose-gathering min-h-64 rounded-control border border-border bg-surface px-4 py-3" dangerouslySetInnerHTML={{ __html: renderCommunityText(body) || "<p></p>" }} />
      ) : (
        <>
          <label htmlFor={`${fieldId}-body`} className="sr-only">
            Entry
          </label>
          <textarea
            id={`${fieldId}-body`}
            ref={area}
            value={body}
            maxLength={100_000}
            placeholder={placeholder ?? "Write freely. Only you can see this."}
            onChange={(e) => edit(title, e.target.value)}
            onBlur={() => void controller.flush()}
            className={cn("block w-full", inline ? "min-h-48" : "min-h-[22rem]", "rounded-control border border-border-strong bg-surface px-4 py-3 text-base leading-relaxed focus-visible:outline-3 focus-visible:outline-primary")}
          />
        </>
      )}
      <p className="mt-2 text-meta text-text-secondary">Supports **bold**, *italic*, lists, and &gt; quotes. Private to you.</p>
    </div>
  );
}
