"use client";

/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { ChevronLeft, ChevronRight, Flag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { reportPhotoAction } from "@/app/(member)/gallery/actions";
import { Button } from "@/components/ui/button";

export type ViewerPhoto = { id: string; thumb: string | null; display: string | null; alt: string; caption: string; width: number | null; height: number | null };

const REASONS = [
  { value: "removal_request", label: "I'm in this photo and want it removed" },
  { value: "privacy", label: "It shares something private" },
  { value: "minor", label: "It shows a child without permission" },
  { value: "inappropriate", label: "It's inappropriate" },
  { value: "other", label: "Something else" },
];

function ReportForm({ photoId, onDone }: { photoId: string; onDone: () => void }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return message?.ok ? (
    <div className="space-y-3">
      <p role="status">{message.text}</p>
      <Button variant="secondary" size="sm" onClick={onDone} autoFocus>
        Close
      </Button>
    </div>
  ) : (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await reportPhotoAction(photoId, String(f.get("reason") ?? ""), String(f.get("details") ?? ""));
          setMessage({ ok: r.ok, text: r.message });
        });
      }}
    >
      <p className="text-meta text-text-secondary">Only gallery moderators see reports. They can hide the photo while they look into it.</p>
      {message && !message.ok ? (
        <p role="alert" className="text-meta font-semibold text-danger">
          {message.text}
        </p>
      ) : null}
      <fieldset className="space-y-1">
        <legend className="font-semibold">What&apos;s wrong?</legend>
        {REASONS.map((r, i) => (
          <label key={r.value} className="flex min-h-11 cursor-pointer items-center gap-3">
            <input type="radio" name="reason" value={r.value} required defaultChecked={i === 0} className="size-5 accent-primary" />
            {r.label}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1">
        <span className="font-semibold">Anything else? (optional)</span>
        <textarea name="details" maxLength={1000} rows={3} className="w-full rounded-control border border-border-strong bg-surface px-3 py-2" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Sending…" : "Send report"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Album grid with an accessible full-screen viewer (a modal dialog with
 * keyboard arrows, swipe-free buttons, and Escape). Links are signed for a
 * few minutes; if one expires the page reloads them.
 */
export function GalleryViewer({ photos, albumTitle }: { photos: ViewerPhoto[]; albumTitle: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [reporting, setReporting] = useState(false);
  const router = useRouter();
  const refreshed = useRef(false);
  const titleId = useId();
  const current = index == null ? null : photos[index];

  const open = (i: number) => {
    setIndex(i);
    setReporting(false);
    dialog.current?.showModal();
  };
  const close = useCallback(() => dialog.current?.close(), []);
  const step = useCallback((d: number) => setIndex((i) => (i == null ? i : (i + d + photos.length) % photos.length)), [photos.length]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (reporting) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    const onClose = () => setIndex(null);
    el.addEventListener("keydown", onKey);
    el.addEventListener("close", onClose);
    return () => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("close", onClose);
    };
  }, [step, reporting]);

  const expired = () => {
    if (refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  };

  return (
    <>
      <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => open(i)}
              aria-haspopup="dialog"
              className="block aspect-square w-full overflow-hidden rounded-tile bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {p.thumb ? <img src={p.thumb} alt={p.alt || `Photo ${i + 1}`} loading="lazy" onError={expired} className="size-full object-cover" /> : <span className="sr-only">Photo {i + 1}</span>}
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
      >
        {current ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-meta font-semibold">
                {albumTitle} · {index! + 1} of {photos.length}
              </h2>
              <button type="button" onClick={() => setReporting((r) => !r)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-meta font-semibold hover:bg-white/10">
                <Flag className="size-4" aria-hidden="true" /> Report or ask to remove
              </button>
              <button type="button" onClick={close} className="flex size-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close photo viewer">
                <X className="size-6" aria-hidden="true" />
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
              {reporting ? (
                <div className="w-[min(32rem,100%)] rounded-card bg-surface p-5 text-text">
                  <ReportForm photoId={current.id} onDone={() => setReporting(false)} />
                </div>
              ) : current.display ? (
                <img src={current.display} alt={current.alt || `Photo ${index! + 1}`} onError={expired} className="max-h-full max-w-full object-contain" />
              ) : null}
              {photos.length > 1 && !reporting ? (
                <>
                  <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                    <ChevronLeft className="size-7" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute right-2 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                    <ChevronRight className="size-7" aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </div>
            {current.caption && !reporting ? (
              <p className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center">{current.caption}</p>
            ) : (
              <div className="pb-[max(1rem,env(safe-area-inset-bottom))]" />
            )}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
