"use client";

import { useState, useTransition } from "react";
import { clearBookProgressAction, saveBookProgressAction } from "@/lib/media/member-actions";

type Progress = { status: "want" | "reading" | "finished"; position: string | null } | null;

const STATUS: Array<{ value: "want" | "reading" | "finished"; label: string }> = [
  { value: "want", label: "Want to read" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
];

/**
 * The member's own place in a book. Private: no one else (including leaders) can see it.
 * One record per book, whichever reading plans it is in; checking off plan
 * assignments never changes it.
 */
export function BookProgressForm({ id, progress, legend = "Where you are" }: { id: string; progress: Progress; legend?: string }) {
  const [status, setStatus] = useState(progress?.status ?? "reading");
  const [position, setPosition] = useState(progress?.position ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState(!!progress);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveBookProgressAction(id, status, position);
          setMessage({ ok: r.ok, text: r.message });
          if (r.ok) setSaved(true);
        });
      }}
    >
      <fieldset>
        <legend className="mb-2 font-semibold">{legend}</legend>
        <div className="flex flex-wrap gap-2">
          {STATUS.map((s) => (
            <label
              key={s.value}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary"
            >
              <input type="radio" name="status" value={s.value} checked={status === s.value} onChange={() => setStatus(s.value)} className="size-4 accent-primary" />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`book-position-${id}`} className="mb-1 block font-semibold">
          Current place <span className="font-normal text-text-secondary">(optional: chapter, page, or listening time)</span>
        </label>
        <input
          id={`book-position-${id}`}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          maxLength={80}
          placeholder="Chapter 4, page 82, or 3h 10m"
          className="min-h-11 w-full rounded-control border border-border-strong/60 bg-surface px-3 sm:max-w-xs"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="min-h-11 rounded-full bg-primary px-5 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
          {pending ? "Saving…" : "Save my progress"}
        </button>
        {saved ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await clearBookProgressAction(id);
                if (r.ok) {
                  setSaved(false);
                  setPosition("");
                  setStatus("reading");
                }
                setMessage({ ok: r.ok, text: r.ok ? "Progress cleared." : "Couldn't clear your progress." });
              })
            }
            className="min-h-11 rounded-full px-4 font-semibold text-text-secondary hover:bg-surface-muted hover:text-text"
          >
            Clear
          </button>
        ) : null}
      </div>
      <p role="status" className={message ? (message.ok ? "text-meta text-text-secondary" : "text-meta font-semibold text-danger") : "sr-only"}>
        {message?.text ?? ""}
      </p>
    </form>
  );
}
