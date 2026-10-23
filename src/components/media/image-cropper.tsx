"use client";

/* eslint-disable @next/next/no-img-element -- local object-URL and signed-URL previews */
import { Check, Minus, Move, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CENTRED, MAX_ZOOM, cleanFraming, describeFraming, framingStyle, panFraming, zoomFraming, type Framing } from "@/lib/media/framing";
import { derivedName, isHeic, loadEditableImage, renderFramed, type EditableImage } from "@/lib/media/image-edit";

/** One frame a photo can be fitted to. `aspect` is width / height; null keeps the whole photo. */
export type CropShape = { id: string; label: string; aspect: number | null };

export const WHOLE_PHOTO: CropShape = { id: "whole", label: "Whole photo", aspect: null };

/** Shapes offered for photos whose cropping is optional (gallery, discussions). */
export const OPTIONAL_SHAPES: CropShape[] = [
  WHOLE_PHOTO,
  { id: "square", label: "Square", aspect: 1 },
  { id: "4:3", label: "4:3", aspect: 4 / 3 },
  { id: "3:4", label: "3:4", aspect: 3 / 4 },
  { id: "16:9", label: "16:9", aspect: 16 / 9 },
];

type Props = {
  image: { url: string; width: number; height: number };
  title: string;
  /** One line under the title (what the frame is for). */
  description?: string;
  shapes: CropShape[];
  initialShape?: string;
  initialFraming?: Framing | null;
  /** Circle for profile photos: the saved square is shown in a circle everywhere. */
  mask?: "circle" | "rect";
  /** Frames whose shape changes with the screen keep a position but no zoom. */
  allowZoom?: boolean;
  /** Smaller frames that show the same framing somewhere else in the app. */
  previews?: Array<{ label: string; aspect: number; round?: boolean }>;
  applyLabel: string;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  onCancel: () => void;
  onApply: (result: { shape: CropShape; framing: Framing }) => void;
};

const STEP = 0.02;
const BIG_STEP = 0.1;

/**
 * Full-screen (phone) or centred (larger screens) photo framer, in a native
 * modal <dialog>: focus moves in and stays there, Escape cancels, and focus
 * returns to where it was. Drag (mouse, pen, or one finger) to move the
 * photo, pinch or scroll to zoom, or use the slider, the − and + buttons, and
 * the arrow keys. Cancel and Apply stay in view below the photo on any screen
 * size and clear the phone's notch and home indicator.
 *
 * The frame shows exactly what will be kept or shown: the same framing
 * function draws the saved image (see lib/media/framing), and the photo
 * always fills the frame, so there are never empty edges.
 */
export function ImageCropper({
  image,
  title,
  description,
  shapes,
  initialShape,
  initialFraming,
  mask = "rect",
  allowZoom = true,
  previews = [],
  applyLabel,
  busy = false,
  busyLabel = "Preparing…",
  error,
  onCancel,
  onApply,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const helpId = useId();
  const zoomId = useId();
  const [shapeId, setShapeId] = useState(initialShape && shapes.some((s) => s.id === initialShape) ? initialShape : shapes[0].id);
  const shape = shapes.find((s) => s.id === shapeId) ?? shapes[0];
  const start = cleanFraming(initialFraming ?? CENTRED);
  const [framing, setFraming] = useState<Framing>(allowZoom ? start : { ...start, zoom: 1 });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [announce, setAnnounce] = useState("");
  const imageAspect = image.width / image.height;
  const aspect = shape.aspect;
  const latest = useRef({ framing, aspect, imageAspect, allowZoom });
  useEffect(() => {
    latest.current = { framing, aspect, imageAspect, allowZoom };
  });
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });
  const done = useRef(false);

  // Open as a modal; on unmount close it first and put focus back.
  useLayoutEffect(() => {
    const d = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    done.current = false;
    if (d && !d.open) d.showModal();
    return () => {
      done.current = true;
      if (d?.open) d.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // The frame takes the largest size of its shape that fits the stage.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const frameAspect = aspect ?? imageAspect;
  const fit = stage.w && stage.h ? (stage.w / stage.h > frameAspect ? { w: stage.h * frameAspect, h: stage.h } : { w: stage.w, h: stage.w / frameAspect }) : null;

  const update = useCallback((next: (f: Framing) => Framing, say = false) => {
    setFraming((f) => {
      const n = next(f);
      if (say) setAnnounce(describeFraming(n));
      return n;
    });
  }, []);

  const pan = useCallback(
    (dx: number, dy: number, say = false) => {
      const { aspect: a, imageAspect: ia } = latest.current;
      if (!a) return;
      update((f) => panFraming(f, dx, dy, ia, a), say);
    },
    [update],
  );
  const zoomTo = useCallback(
    (zoom: number, anchor?: { x: number; y: number }, say = false) => {
      const { aspect: a, imageAspect: ia, allowZoom: can } = latest.current;
      if (!a || !can) return;
      update((f) => zoomFraming(f, zoom, ia, a, anchor), say);
    },
    [update],
  );

  // Pointer gestures: one pointer drags, two pinch (and drag by their midpoint).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; mid: { x: number; y: number } } | null>(null);
  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!aspect || busy) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some pointer streams can't be captured; dragging still works inside the frame.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { ...pinchState(), zoom: latest.current.framing.zoom };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    const frame = frameRef.current;
    if (!prev || !frame) return;
    const box = frame.getBoundingClientRect();
    if (pointers.current.size === 1) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pan((e.clientX - prev.x) / box.width, (e.clientY - prev.y) / box.height);
      return;
    }
    if (pointers.current.size !== 2 || !pinch.current) return;
    const before = pinchState();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = pinchState();
    pan((now.mid.x - before.mid.x) / box.width, (now.mid.y - before.mid.y) / box.height);
    if (pinch.current.dist > 0) {
      zoomTo(pinch.current.zoom * (now.dist / pinch.current.dist), { x: (now.mid.x - box.left) / box.width, y: (now.mid.y - box.top) / box.height });
    }
  }
  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  // Wheel and trackpad pinch zoom around the pointer (needs a non-passive listener).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      if (!latest.current.aspect || !latest.current.allowZoom) return;
      e.preventDefault();
      const box = frame.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      zoomTo(latest.current.framing.zoom * factor, { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [zoomTo, aspect]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!aspect || busy) return;
    const step = e.shiftKey ? BIG_STEP : STEP;
    const keys: Record<string, () => void> = {
      // Arrow keys move the visible area the way the arrow points.
      ArrowLeft: () => pan(step, 0, true),
      ArrowRight: () => pan(-step, 0, true),
      ArrowUp: () => pan(0, step, true),
      ArrowDown: () => pan(0, -step, true),
      "+": () => zoomTo(framing.zoom + 0.1, undefined, true),
      "=": () => zoomTo(framing.zoom + 0.1, undefined, true),
      "-": () => zoomTo(framing.zoom - 0.1, undefined, true),
      "0": () => reset(),
      Home: () => reset(),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  }

  function reset() {
    setFraming(CENTRED);
    setAnnounce(`Reset. ${describeFraming(CENTRED)}`);
  }

  const close = () => ref.current?.close();
  const imgStyle: CSSProperties = aspect ? framingStyle(framing) : { objectFit: "contain" };
  const canZoom = allowZoom && !!aspect;

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={helpId}
      // Escape, the close button, and Cancel all end up here.
      onClose={() => {
        // Ignore a close from an unmount (or a development re-mount, which re-opens it).
        if (!done.current && !ref.current?.open) onCancelRef.current();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-surface p-0 text-text backdrop:bg-black/60 backdrop:backdrop-blur-[2px] sm:m-auto sm:h-[min(52rem,calc(100dvh-2rem))] sm:w-[min(46rem,calc(100%-2rem))] sm:rounded-card sm:border sm:border-border sm:shadow-(--elev-lift)"
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-xl font-semibold leading-tight">
              {title}
            </h2>
            {description ? <p className="truncate text-meta text-text-secondary">{description}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={close} aria-label="Close without using this photo" icon={<X className="size-5" aria-hidden="true" />} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div ref={stageRef} className="relative m-3 min-h-44 flex-1 sm:m-4">
            {fit ? (
              <div
                ref={frameRef}
                tabIndex={aspect ? 0 : -1}
                role={aspect ? "group" : "img"}
                aria-roledescription={aspect ? "photo position" : undefined}
                aria-label={aspect ? `${shape.label} frame. ${describeFraming(framing)}` : "The whole photo will be used"}
                aria-describedby={aspect ? helpId : undefined}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onKeyDown={onKeyDown}
                style={{ width: fit.w, height: fit.h }}
                className={cn(
                  "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-surface-muted select-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-primary",
                  aspect ? "cursor-grab touch-none active:cursor-grabbing" : "",
                  mask === "circle" && aspect ? "rounded-full" : "rounded-control",
                  "ring-1 ring-border-strong",
                )}
              >
                <img src={image.url} alt="" draggable={false} className="pointer-events-none size-full" style={imgStyle} />
              </div>
            ) : null}
          </div>

          <div className="space-y-3 px-4 pb-3 sm:px-6">
            <p id={helpId} className="flex items-start gap-2 text-meta text-text-secondary">
              <Move className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {aspect
                ? canZoom
                  ? "Drag the photo to move it, and pinch or use the slider to zoom. With a keyboard, focus the photo and use the arrow keys (Shift for bigger steps), + and − to zoom, and 0 to reset."
                  : "Drag the photo to choose the part that must stay visible. With a keyboard, focus the photo and use the arrow keys (Shift for bigger steps), and 0 to reset."
                : "The whole photo is used, uncropped. Choose a shape to crop it."}
            </p>

            {canZoom ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" className="w-11 px-0" aria-label="Zoom out" disabled={busy || framing.zoom <= 1} onClick={() => zoomTo(framing.zoom - 0.25, undefined, true)}>
                  <Minus className="size-4" aria-hidden="true" />
                </Button>
                <label htmlFor={zoomId} className="sr-only">
                  Zoom
                </label>
                <input
                  id={zoomId}
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={framing.zoom}
                  disabled={busy}
                  aria-valuetext={`${Math.round(framing.zoom * 100)}%`}
                  onChange={(e) => zoomTo(Number(e.currentTarget.value))}
                  className="h-11 min-w-0 flex-1 cursor-pointer accent-primary"
                />
                <Button variant="secondary" size="sm" className="w-11 px-0" aria-label="Zoom in" disabled={busy || framing.zoom >= MAX_ZOOM} onClick={() => zoomTo(framing.zoom + 0.25, undefined, true)}>
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
                <span className="w-12 text-right text-meta tabular-nums text-text-secondary" aria-hidden="true">
                  {Math.round(framing.zoom * 100)}%
                </span>
              </div>
            ) : null}

            {shapes.length > 1 ? (
              <fieldset>
                <legend className="mb-1.5 text-meta font-semibold">Shape</legend>
                <div className="flex flex-wrap gap-1.5">
                  {shapes.map((s) => (
                    <label
                      key={s.id}
                      className={cn(
                        "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-meta font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                        s.id === shapeId ? "border-primary bg-primary-soft text-text" : "border-border-strong/60 text-text-secondary hover:bg-surface-muted",
                      )}
                    >
                      <input type="radio" name={`${titleId}-shape`} value={s.id} checked={s.id === shapeId} onChange={() => setShapeId(s.id)} className="sr-only" disabled={busy} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {previews.length && aspect ? (
              <div className="flex flex-wrap items-end gap-3" aria-hidden="true">
                {previews.map((p) => (
                  <figure key={p.label} className="w-24">
                    <div className={cn("overflow-hidden bg-surface-muted ring-1 ring-border", p.round ? "rounded-full" : "rounded-tile")} style={{ aspectRatio: String(p.aspect) }}>
                      <img src={image.url} alt="" className="size-full" style={framingStyle(framing)} />
                    </div>
                    <figcaption className="mt-1 text-[0.8125rem] text-text-secondary">{p.label}</figcaption>
                  </figure>
                ))}
              </div>
            ) : null}

            {error ? (
              <Alert tone="error" title="That didn't work.">
                <p>{error}</p>
              </Alert>
            ) : null}
            <p className="sr-only" aria-live="polite">
              {announce}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          {aspect ? (
            <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={reset} disabled={busy} className="mr-auto">
              Reset
            </Button>
          ) : (
            <span className="mr-auto" />
          )}
          <Button variant="secondary" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" loading={busy} loadingText={busyLabel} icon={<Check className="size-4" aria-hidden="true" />} onClick={() => onApply({ shape, framing: aspect ? framing : CENTRED })}>
            {applyLabel}
          </Button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/** What an optional crop produced: the file to upload and how to reopen the editor. */
export type OptionalCrop = { file: File; shapeId: string; framing: Framing };

/**
 * Optional cropping for photos that keep their whole image by default
 * (gallery and discussion photos). Opens `original` in the cropper with
 * "Whole photo" first; "Use photo" returns the original itself for the
 * whole photo, or a cropped copy (no metadata, at most 4096 px) for a
 * shape. Reopening with the previous shapeId and framing continues from
 * the original, so cropping again never compounds. `onUnsupported` is called
 * when this browser can't show the photo (for example HEIC outside Safari),
 * which then uploads whole.
 */
export function OptionalCropDialog({
  original,
  shapeId,
  framing,
  onCancel,
  onDone,
  onUnsupported,
}: {
  original: File;
  shapeId?: string;
  framing?: Framing;
  onCancel: () => void;
  onDone: (result: OptionalCrop) => void;
  onUnsupported: (message: string) => void;
}) {
  const [image, setImage] = useState<EditableImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failRef = useRef(onUnsupported);
  useEffect(() => {
    failRef.current = onUnsupported;
  });

  useEffect(() => {
    let live = true;
    let loaded: EditableImage | null = null;
    loadEditableImage(original)
      .then((img) => {
        loaded = img;
        if (live) setImage(img);
        else img.release();
      })
      .catch(() => {
        if (live) failRef.current(isHeic(original) ? "This browser can't show iPhone (HEIC) photos, so it can't be cropped here. It will be uploaded whole." : "This photo can't be shown here, so it can't be cropped. It will be uploaded whole.");
      });
    return () => {
      live = false;
      loaded?.release();
    };
  }, [original]);

  if (!image) {
    return (
      <p role="status" className="sr-only">
        Opening the photo…
      </p>
    );
  }
  return (
    <ImageCropper
      image={image}
      title="Crop photo"
      description={original.name}
      shapes={OPTIONAL_SHAPES}
      initialShape={shapeId ?? WHOLE_PHOTO.id}
      initialFraming={framing}
      applyLabel="Use photo"
      busy={busy}
      error={error}
      onCancel={onCancel}
      onApply={async ({ shape, framing: f }) => {
        if (!shape.aspect) return onDone({ file: original, shapeId: WHOLE_PHOTO.id, framing: CENTRED });
        setBusy(true);
        setError(null);
        try {
          const type = original.type === "image/png" ? "image/png" : "image/jpeg";
          const file = await renderFramed(image, { aspect: shape.aspect, framing: f, maxSide: 4096, type, name: derivedName(original.name, type) });
          onDone({ file, shapeId: shape.id, framing: f });
        } catch {
          setError("This photo couldn't be cropped on this device. Try again, or use the whole photo.");
          setBusy(false);
        }
      }}
    />
  );
}
