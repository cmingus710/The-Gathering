"use client";

import {
  AlertTriangle,
  Brush,
  Check,
  CheckCircle2,
  Download,
  Eraser,
  Hand,
  Loader2,
  Maximize,
  PaintBucket,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { AutosaveController, type AutosaveState, type SaveResponse } from "@/lib/journal/autosave";
import {
  BRUSHES,
  PALETTE,
  addStroke,
  colorHex,
  colorLabel,
  coloringStatusLabel,
  docTooLarge,
  emptyDoc,
  encodePoints,
  fillRegion,
  historyPush,
  historyRedo,
  historyStart,
  historyUndo,
  isEmptyDoc,
  parseDoc,
  serializeDoc,
  type BrushKey,
  type ColorKey,
  type ColoringDoc,
  type ColoringTemplate,
  type History,
  type Point,
  type Stroke,
} from "@/lib/youth/coloring";
import { SIGNED_OUT_KEY, clearColoringDraft, coloringKey, purgeColoringDrafts, readColoringDraft, reconcileColoring, writeColoringDraft } from "@/lib/youth/coloring-local";
import { ColoringFills, ColoringLines } from "./picture";
import { drawStroke, exportPng, fileSlug, paintStrokes, regionAt, regionPaths } from "./render";

type Tool = "fill" | "brush" | "eraser" | "move";
type View = { zoom: number; x: number; y: number };

const MAX_ZOOM = 6;
const MAX_CANVAS_PX = 3000;
const TAP_SLOP_PX = 10;

export type StudioProps = {
  activityId: string;
  versionId: string;
  title: string;
  template: ColoringTemplate;
  /** Signed-in account (device copies are kept per account and child). */
  accountId: string;
  /** The chosen child (guardians); null when a youth colors as themselves. */
  child: string | null;
  /** The child profile the artwork belongs to (for the device copy key). */
  childId: string;
  childName: string;
  initial: { doc: ColoringDoc; revision: number; updatedAt: string | null };
  lineArtUrl?: string | null;
  /** "preview": the editor trying it out; nothing is saved anywhere. */
  mode?: "live" | "preview";
};

function toResponse(status: number, data: Record<string, unknown>): SaveResponse {
  if (status === 200) return { kind: "saved", version: Number(data.version), updatedAt: String(data.updated_at ?? "") };
  if (status === 409) {
    const c = (data.current ?? {}) as { body?: string; version?: number; updated_at?: string | null };
    return { kind: "conflict", current: { title: "", body: c.body ?? serializeDoc(emptyDoc()), version: Number(c.version ?? 0), updatedAt: String(c.updated_at ?? "") } };
  }
  if (status === 401) return { kind: "signed_out" };
  const message = typeof data.error === "string" ? data.error : "That couldn't be saved.";
  return { kind: "error", retryable: status === 429 || status >= 500, message };
}

const clampView = (v: View, w: number, h: number): View => {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
  return { zoom, x: Math.min(0, Math.max(w - w * zoom, v.x)), y: Math.min(0, Math.max(h - h * zoom, v.y)) };
};

/**
 * Bible Coloring Studio. Tap-to-fill parts (for region pictures), a
 * freehand brush, an eraser for brush strokes, undo and redo for every
 * change, start over, zoom and pan, and "stay inside the lines".
 *
 * Input: one finger, a stylus, or a mouse draws or fills with the chosen
 * tool; two fingers (or the Move tool, Ctrl + scroll, or the zoom buttons)
 * only ever zoom and pan, and a second finger cancels a stroke in progress.
 * The page scrolls normally outside the picture.
 *
 * Saving: debounced autosave with one save in flight, each naming the
 * revision it was based on, so an older tab or device can't silently
 * overwrite newer work. Until the server confirms, a copy is kept on this
 * device for this account and child, and removed once saved.
 */
export function ColoringStudio(props: StudioProps) {
  const { activityId, versionId, title, template: t, accountId, child, childId, childName, initial, lineArtUrl, mode = "live" } = props;
  const live = mode === "live";
  const uid = useId();
  const regions = t.mode === "regions";
  const key = coloringKey(accountId, childId, versionId);
  const initialBody = useMemo(() => serializeDoc(initial.doc), [initial.doc]);

  const [history, setHistory] = useState<History>(() => historyStart(initial.doc));
  const doc = history.present;
  const [tool, setTool] = useState<Tool>(regions ? "fill" : "brush");
  const [color, setColor] = useState<ColorKey>("red");
  const [brush, setBrush] = useState<BrushKey>("m");
  const [inside, setInside] = useState(false);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [deviceCopy, setDeviceCopy] = useState<ColoringDoc | null>(null);
  const [saveState, setSaveState] = useState<AutosaveState | null>(null);
  const [exporting, setExporting] = useState(false);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const exportImg = useRef<HTMLImageElement | null>(null);
  const lastBody = useRef(initialBody);
  // While the "this device vs saved" choice is open, the device copy stays in storage untouched.
  const choosing = useRef(false);
  // Signed out in another tab: stop keeping copies on this device.
  const signedOut = useRef(false);
  const keep = useCallback(
    (body: string, base: number) => {
      if (!signedOut.current) writeColoringDraft(key, { doc: body, base, at: Date.now() });
    },
    [key],
  );
  const paths = useMemo(() => regionPaths(t), [t]);
  const hitCtx = useRef<CanvasRenderingContext2D | null>(null);

  const [controller] = useState(
    () =>
      new AutosaveController({
        initial: { title: "", body: initialBody, version: initial.revision, updatedAt: initial.updatedAt },
        debounceMs: 1500,
        onState: (s) => setSaveState(s),
        save: async (req) => {
          try {
            const res = await fetch(`/api/youth/coloring/${activityId}`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              // The picture is already JSON text; it is embedded as is.
              body: `{"child":${JSON.stringify(child)},"version":${JSON.stringify(versionId)},"base_version":${req.baseVersion},"doc":${req.body}}`,
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

  // ---------------------------------------------------------------------
  // Device copy: restore, conflict, and cleanup
  // ---------------------------------------------------------------------
  // Once per mount (the studio is keyed by child and version): a page refresh
  // after "Mark finished" passes new props but must not restore twice.
  const reconciled = useRef(false);
  useEffect(() => {
    if (!live || reconciled.current) return;
    reconciled.current = true;
    purgeColoringDrafts({ keepAccount: accountId });
    const decision = reconcileColoring({ doc: initialBody, revision: initial.revision }, readColoringDraft(key));
    const parsed = decision.kind === "none" ? null : parseDoc(decision.doc, t);
    if (decision.kind === "restore" && parsed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring browser-only storage after hydration
      setHistory((h) => historyPush(h, parsed));
      setNotice("Restored changes from this device that hadn't been saved yet. Use Undo to go back to the saved picture.");
    } else if (decision.kind === "conflict" && parsed) {
      choosing.current = true;
      setDeviceCopy(parsed);
    } else {
      clearColoringDraft(key);
    }
  }, [accountId, initial.revision, initialBody, key, live, t]);

  // Every change (fills, strokes, undo, redo, start over) is autosaved.
  useEffect(() => {
    if (!live) return;
    const body = serializeDoc(doc);
    if (body === lastBody.current) return;
    lastBody.current = body;
    controller.edit({ title: "", body });
    keep(body, controller.current.version);
  }, [doc, controller, keep, live]);

  // Keep (or drop) the device copy as the saved state changes.
  useEffect(() => {
    if (!live || !saveState || choosing.current) return;
    if (controller.dirty) keep(controller.text.body, saveState.version);
    else clearColoringDraft(key);
  }, [saveState, controller, key, keep, live]);

  useEffect(() => {
    if (!live) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIGNED_OUT_KEY) return;
      signedOut.current = true;
      clearColoringDraft(key);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, live]);

  useEffect(() => {
    if (!live) return;
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
      // Switching children or leaving: send what's pending now (the device copy stays until it's confirmed).
      void controller.flush();
      controller.dispose();
    };
  }, [controller, live]);

  // Line art for the export, loaded once with permission to draw it on a canvas.
  useEffect(() => {
    if (!lineArtUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = lineArtUrl;
    exportImg.current = img;
  }, [lineArtUrl]);

  // ---------------------------------------------------------------------
  // Surface size and the stroke layer
  // ---------------------------------------------------------------------
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize({ w, h });
      setView((v) => clampView(v, w, h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sharper strokes when zoomed in, settled shortly after zooming stops.
  const [resZoom, setResZoom] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => setResZoom(view.zoom), 150);
    return () => clearTimeout(id);
  }, [view.zoom]);

  const pxPerUnit = useMemo(() => {
    if (!size.w) return 1;
    const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 3);
    const wanted = (size.w * dpr * resZoom) / t.width;
    return Math.min(wanted, MAX_CANVAS_PX / Math.max(t.width, t.height));
  }, [size.w, resZoom, t.width, t.height]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w) return;
    const w = Math.round(t.width * pxPerUnit);
    const h = Math.round(t.height * pxPerUnit);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (ctx) paintStrokes(ctx, doc, paths, pxPerUnit);
  }, [doc, paths, pxPerUnit, size.w, t.height, t.width]);

  const hit = useCallback(
    (x: number, y: number) => {
      if (!regions) return null;
      if (!hitCtx.current) hitCtx.current = document.createElement("canvas").getContext("2d");
      return hitCtx.current ? regionAt(t, paths, hitCtx.current, x, y) : null;
    },
    [paths, regions, t],
  );

  // ---------------------------------------------------------------------
  // Edits
  // ---------------------------------------------------------------------
  const commit = useCallback((next: ColoringDoc, message?: string) => {
    if (choosing.current) {
      setAnnounce("First choose which picture to keep, above.");
      return;
    }
    setHistory((h) => historyPush(h, next));
    if (message) setAnnounce(message);
  }, []);

  const fillPart = useCallback(
    (id: string) => {
      const r = t.regions.find((x) => x.id === id);
      if (!r) return;
      commit(fillRegion(doc, id, color), `${r.label}: ${colorLabel(color)}.`);
    },
    [color, commit, doc, t.regions],
  );

  const undo = () => {
    if (!history.past.length || choosing.current) return;
    setHistory(historyUndo);
    setAnnounce("Undone.");
  };
  const redo = () => {
    if (!history.future.length || choosing.current) return;
    setHistory(historyRedo);
    setAnnounce("Redone.");
  };

  // ---------------------------------------------------------------------
  // Pointer input
  // ---------------------------------------------------------------------
  type Gesture =
    | { kind: "draw"; id: number; stroke: Pick<Stroke, "t" | "c" | "s" | "r">; points: Point[] }
    | { kind: "tap"; id: number; x: number; y: number; at: number }
    | { kind: "pan"; id: number; x: number; y: number; start: View }
    | { kind: "pinch"; d0: number; mx: number; my: number; start: View }
    | { kind: "idle" };
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const gesture = useRef<Gesture>({ kind: "idle" });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toUnits = (p: { x: number; y: number }, v = view): Point => ({ x: ((p.x - v.x) / v.zoom) * (t.width / size.w), y: ((p.y - v.y) / v.zoom) * (t.height / size.h) });

  const redrawStrokes = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) paintStrokes(ctx, doc, paths, pxPerUnit);
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    if (gesture.current.kind === "draw") redrawStrokes(); // a second finger cancels the stroke
    gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, start: view };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!size.w || (e.pointerType === "mouse" && e.button !== 0)) return;
    // Palm rejection: while a stylus is down, touches are ignored.
    if (e.pointerType === "touch" && [...pointers.current.values()].some((p) => p.type === "pen")) return;
    const p = local(e);
    pointers.current.set(e.pointerId, { ...p, type: e.pointerType });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;
    if (tool === "move") {
      gesture.current = { kind: "pan", id: e.pointerId, x: p.x, y: p.y, start: view };
      return;
    }
    if (tool === "fill") {
      gesture.current = { kind: "tap", id: e.pointerId, x: p.x, y: p.y, at: Date.now() };
      return;
    }
    const u = toUnits(p);
    let r: string | undefined;
    if (tool === "brush" && inside && regions) {
      r = hit(u.x, u.y) ?? undefined;
      if (!r) {
        gesture.current = { kind: "idle" };
        setAnnounce("Start inside a part of the picture to color it (Stay inside the lines is on).");
        return;
      }
    }
    const stroke: Pick<Stroke, "t" | "c" | "s" | "r"> = tool === "eraser" ? { t: "erase", s: brush } : { t: "paint", c: color, s: brush, r };
    gesture.current = { kind: "draw", id: e.pointerId, stroke, points: [u] };
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.setTransform(pxPerUnit, 0, 0, pxPerUnit, 0, 0);
      drawStroke(ctx, stroke, [u], paths);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, { ...p, type: e.pointerType });
    const g = gesture.current;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, g.start.zoom * (d / g.d0)));
      const cx = (g.mx - g.start.x) / g.start.zoom;
      const cy = (g.my - g.start.y) / g.start.zoom;
      setView(clampView({ zoom, x: mx - cx * zoom, y: my - cy * zoom }, size.w, size.h));
    } else if (g.kind === "pan" && g.id === e.pointerId) {
      setView(clampView({ ...g.start, x: g.start.x + p.x - g.x, y: g.start.y + p.y - g.y }, size.w, size.h));
    } else if (g.kind === "draw" && g.id === e.pointerId) {
      const native = e.nativeEvent as PointerEvent;
      const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
      const ctx = canvasRef.current?.getContext("2d");
      for (const ev of events.length ? events : [native]) {
        const u = toUnits(local(ev));
        const last = g.points[g.points.length - 1];
        g.points.push(u);
        if (ctx) {
          ctx.setTransform(pxPerUnit, 0, 0, pxPerUnit, 0, 0);
          drawStroke(ctx, g.stroke, [last, u], paths);
        }
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === "pinch") {
      if (pointers.current.size === 0) gesture.current = { kind: "idle" };
      return;
    }
    if (g.kind === "tap" && g.id === e.pointerId) {
      gesture.current = { kind: "idle" };
      if (e.type === "pointerup" && Math.hypot(p.x - g.x, p.y - g.y) <= TAP_SLOP_PX) {
        const u = toUnits(p);
        const id = hit(u.x, u.y);
        if (id) fillPart(id);
      }
      return;
    }
    if (g.kind === "draw" && g.id === e.pointerId) {
      gesture.current = { kind: "idle" };
      if (e.type !== "pointerup") {
        redrawStrokes();
        return;
      }
      if (docTooLarge(doc)) {
        redrawStrokes();
        setNotice("This picture is full of brush strokes. Use tap-to-fill, undo some strokes, or start over to keep drawing.");
        return;
      }
      const pts = encodePoints(g.points);
      if (pts) commit(addStroke(doc, { ...g.stroke, p: pts } as Stroke));
      return;
    }
    if (pointers.current.size === 0) gesture.current = { kind: "idle" };
  };

  // Ctrl + scroll (and trackpad pinch) zooms; plain scrolling still scrolls the page.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY / 300);
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      setView((v) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor));
        return clampView({ zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom }, el.clientWidth, el.clientHeight);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    setView((v) => {
      const cx = size.w / 2;
      const cy = size.h / 2;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor));
      return clampView({ zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom }, size.w, size.h);
    });
  };

  const onSurfaceKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 48;
    const pan = (dx: number, dy: number) => setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, size.w, size.h));
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-" || e.key === "_") zoomBy(0.8);
    else if (e.key === "0") setView({ zoom: 1, x: 0, y: 0 });
    else if (e.key === "ArrowLeft") pan(step, 0);
    else if (e.key === "ArrowRight") pan(-step, 0);
    else if (e.key === "ArrowUp") pan(0, step);
    else if (e.key === "ArrowDown") pan(0, -step);
    else return;
    e.preventDefault();
  };

  const onStudioKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) undo();
    else if ((k === "z" && e.shiftKey) || k === "y") redo();
    else return;
    e.preventDefault();
  };

  // ---------------------------------------------------------------------
  // Start over, export
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (confirmReset) confirmRef.current?.focus();
  }, [confirmReset]);

  const reset = () => {
    commit(emptyDoc(), "Started over. Use Undo to bring the coloring back.");
    setConfirmReset(false);
    resetButtonRef.current?.focus();
  };

  const download = async () => {
    setExporting(true);
    const blob = await exportPng(t, doc, exportImg.current);
    setExporting(false);
    if (!blob) {
      setNotice("The picture couldn't be made into an image on this device. Try again after reloading the page.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coloring-${fileSlug(title)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setAnnounce("Picture downloaded.");
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  const s = saveState ?? controller.current;
  const status = !live ? "preview" : s.status;
  const statusIcon =
    status === "preview" ? null
    : status === "saved" ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
    : status === "unsaved" || status === "saving" || status === "retrying" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    : <AlertTriangle className="size-4 text-danger" aria-hidden="true" />;
  const failed = ["failed", "offline", "signed_out"].includes(status);
  const ratio = t.width / t.height;
  const toolLabel = { fill: "Fill", brush: "Brush", eraser: "Eraser", move: "Move" }[tool];
  const describedBy = `${uid}-help`;

  const tools: Array<{ key: Tool; label: string; icon: ReactNode; hint: string }> = [
    ...(regions ? [{ key: "fill" as Tool, label: "Fill", icon: <PaintBucket className="size-5 shrink-0" aria-hidden="true" />, hint: "Tap a part to fill it" }] : []),
    { key: "brush", label: "Brush", icon: <Brush className="size-5 shrink-0" aria-hidden="true" />, hint: "Draw with one finger, stylus, or mouse" },
    { key: "eraser", label: "Eraser", icon: <Eraser className="size-5 shrink-0" aria-hidden="true" />, hint: "Erases brush strokes only" },
    { key: "move", label: "Move", icon: <Hand className="size-5 shrink-0" aria-hidden="true" />, hint: "Drag to move around when zoomed in" },
  ];

  return (
    <div className="space-y-4" onKeyDown={onStudioKey}>
      {deviceCopy ? (
        <ChoicePanel
          title="This device has coloring that wasn't saved, and the saved picture changed since (on another device or tab)."
          t={t}
          lineArtUrl={lineArtUrl}
          left={{ label: "On this device", doc: deviceCopy }}
          right={{ label: "Saved", doc }}
          actions={
            <>
              <Button
                size="sm"
                onClick={() => {
                  choosing.current = false;
                  commit(deviceCopy, "Using this device's picture.");
                  setDeviceCopy(null);
                }}
              >
                Use this device&apos;s picture
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  choosing.current = false;
                  clearColoringDraft(key);
                  setDeviceCopy(null);
                }}
              >
                Keep the saved picture
              </Button>
            </>
          }
        />
      ) : null}
      {s.status === "conflict" && s.conflict && live ? (
        <ChoicePanel
          alert
          title="This picture was saved on another device or tab while you were coloring."
          t={t}
          lineArtUrl={lineArtUrl}
          left={{ label: "Yours (on this page)", doc }}
          right={{ label: "Saved elsewhere", doc: parseDoc(s.conflict.body, t) ?? emptyDoc() }}
          actions={
            <>
              <Button size="sm" onClick={() => controller.keepMine()}>
                Keep mine
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  // Only switch once the saved picture is known to be readable here.
                  const next = s.conflict ? parseDoc(s.conflict.body, t) : null;
                  if (!next) {
                    setNotice("The saved picture couldn't be opened here, so yours is kept. Choose Keep mine, or reload the page.");
                    return;
                  }
                  const saved = controller.useSaved();
                  if (saved) {
                    lastBody.current = saved.body;
                    setHistory(historyStart(next));
                  }
                }}
              >
                Use the saved one
              </Button>
            </>
          }
        />
      ) : null}
      {notice ? (
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-card border border-primary bg-primary-soft p-3 text-meta" role="status">
          <p>{notice}</p>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" aria-live="polite" data-testid="coloring-status" className={cn("flex min-h-11 items-center gap-1.5 text-meta", status === "saved" ? "text-text-secondary" : "font-semibold text-text")}>
              {statusIcon}
              {status === "preview"
                ? "Preview: nothing is saved."
                : isEmptyDoc(doc) && status === "saved" && initial.revision === 0
                  ? "Saves as you color."
                  : coloringStatusLabel(status)}
              {failed ? <span className="font-normal"> · Your coloring is kept on this device until it saves.</span> : null}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={undo} disabled={!history.past.length} icon={<Undo2 className="size-5 shrink-0" aria-hidden="true" />}>
                Undo
              </Button>
              <Button variant="secondary" size="sm" onClick={redo} disabled={!history.future.length} icon={<Redo2 className="size-5 shrink-0" aria-hidden="true" />}>
                Redo
              </Button>
            </div>
          </div>
          {failed && live ? (
            <div className="flex flex-wrap items-center gap-2 text-meta">
              {s.message ? <span>{s.message}</span> : null}
              <Button size="sm" variant="ghost" onClick={() => controller.resume()} icon={<RotateCcw className="size-4" aria-hidden="true" />}>
                Retry now
              </Button>
              {s.status === "signed_out" ? (
                <a href="/sign-in" target="_blank" rel="noopener" className="font-semibold text-primary underline">
                  Sign in in a new tab, then choose Retry now
                </a>
              ) : null}
              {s.status === "failed" && s.attempt === 0 ? (
                <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              ) : null}
            </div>
          ) : null}

          <div
            ref={surfaceRef}
            role="application"
            aria-roledescription="coloring picture"
            aria-label={`${title}: ${toolLabel} tool${tool === "brush" || tool === "fill" ? `, ${colorLabel(color)}` : ""}`}
            aria-describedby={describedBy}
            tabIndex={0}
            onKeyDown={onSurfaceKey}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="coloring-surface"
            data-tool={tool}
            className={cn(
              "relative mx-auto overflow-hidden rounded-tile border-2 border-border-strong bg-white select-none [-webkit-touch-callout:none]",
              "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
              tool === "move" ? "cursor-grab" : tool === "fill" ? "cursor-pointer" : "cursor-crosshair",
            )}
            style={{ touchAction: "none", aspectRatio: `${t.width} / ${t.height}`, width: `min(100%, calc(68svh * ${ratio}))` }}
          >
            <div className="absolute inset-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
              <ColoringFills t={t} fills={doc.fills} className="absolute inset-0 size-full" />
              <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden="true" />
              <ColoringLines t={t} lineArtUrl={lineArtUrl} highlight={highlight} className="pointer-events-none absolute inset-0 size-full" />
            </div>
          </div>
          <p id={describedBy} className="text-meta text-text-secondary">
            {regions ? "Tap a part with Fill, or draw with Brush. " : "This picture is for freehand coloring with the brush (it has no tap-to-fill parts). "}
            Use two fingers, the Move tool, or the zoom buttons to zoom and move around. Outside the picture, the page scrolls as usual.
            {regions ? " Keyboard: fill parts from the list of parts below." : ""} With the picture focused, + and − zoom and arrow keys move.
          </p>
        </div>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="font-semibold">Tool</legend>
            <div className={cn("grid gap-2", regions ? "grid-cols-4 lg:grid-cols-2" : "grid-cols-3")}>
              {tools.map((x) => (
                <ToggleButton key={x.key} pressed={tool === x.key} onClick={() => setTool(x.key)} title={x.hint}>
                  {x.icon}
                  <span>{x.label}</span>
                </ToggleButton>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="font-semibold">
              Color <span className="font-normal text-text-secondary">· {colorLabel(color)}</span>
            </legend>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-4">
              {PALETTE.map((c) => {
                const on = color === c.key;
                return (
                  <ToggleButton
                    key={c.key}
                    pressed={on}
                    onClick={() => {
                      setColor(c.key);
                      if (tool === "eraser" || tool === "move") setTool(regions ? "fill" : "brush");
                    }}
                    className="flex-col gap-1 px-1 py-1.5"
                  >
                    <span className="relative inline-flex size-8 items-center justify-center rounded-full border-2 border-border-strong" style={{ background: c.hex }} aria-hidden="true">
                      {on ? <Check className={cn("size-5", ["white", "yellow", "peach", "sky", "pink"].includes(c.key) ? "text-black" : "text-white")} strokeWidth={3} /> : null}
                    </span>
                    <span className="text-[0.8125rem] leading-tight">{c.label}</span>
                  </ToggleButton>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-2" disabled={tool !== "brush" && tool !== "eraser"}>
            <legend className="font-semibold">Brush size</legend>
            <div className="grid grid-cols-3 gap-2">
              {BRUSHES.map((b) => (
                <ToggleButton key={b.key} pressed={brush === b.key} onClick={() => setBrush(b.key)} disabled={tool !== "brush" && tool !== "eraser"}>
                  <span className="inline-flex size-7 items-center justify-center" aria-hidden="true">
                    <span className="rounded-full bg-current" style={{ width: Math.round(4 + b.width / 2), height: Math.round(4 + b.width / 2) }} />
                  </span>
                  <span>{b.label}</span>
                </ToggleButton>
              ))}
            </div>
          </fieldset>

          {regions ? (
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-tile border border-border p-3">
              <input type="checkbox" role="switch" checked={inside} onChange={(e) => setInside(e.target.checked)} className="size-6 shrink-0 accent-[var(--color-primary)]" />
              <span>
                <span className="block font-semibold">Stay inside the lines</span>
                <span className="block text-meta text-text-secondary">The brush only colors the part where a stroke starts.</span>
              </span>
            </label>
          ) : null}

          <div className="space-y-2">
            <p className="font-semibold">
              View <span className="font-normal text-text-secondary">· {Math.round(view.zoom * 100)}%</span>
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" size="sm" className="px-2 whitespace-nowrap" onClick={() => zoomBy(0.8)} disabled={view.zoom <= 1} icon={<ZoomOut className="size-5 shrink-0" aria-hidden="true" />}>
                Zoom out
              </Button>
              <Button variant="secondary" size="sm" className="px-2 whitespace-nowrap" onClick={() => zoomBy(1.25)} disabled={view.zoom >= MAX_ZOOM} icon={<ZoomIn className="size-5 shrink-0" aria-hidden="true" />}>
                Zoom in
              </Button>
              <Button variant="secondary" size="sm" className="px-2 whitespace-nowrap" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} disabled={view.zoom === 1} icon={<Maximize className="size-5 shrink-0" aria-hidden="true" />}>
                Fit
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button ref={resetButtonRef} variant="danger-outline" size="sm" onClick={() => setConfirmReset(true)} disabled={isEmptyDoc(doc)} icon={<Trash2 className="size-5 shrink-0" aria-hidden="true" />}>
              Start over
            </Button>
            <Button variant="secondary" size="sm" onClick={download} loading={exporting} loadingText="Preparing…" icon={<Download className="size-5 shrink-0" aria-hidden="true" />}>
              Download
            </Button>
          </div>
          {confirmReset ? (
            <div role="alertdialog" aria-labelledby={`${uid}-reset`} aria-describedby={`${uid}-reset-d`} className="space-y-2 rounded-card border border-danger bg-danger-soft p-3">
              <p id={`${uid}-reset`} className="font-semibold">
                Start over?
              </p>
              <p id={`${uid}-reset-d`} className="text-meta">
                This clears all the coloring on this picture{live ? ` for ${childName}` : ""}. You can still use Undo right after.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button ref={confirmRef} variant="danger" size="sm" onClick={reset}>
                  Yes, start over
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setConfirmReset(false);
                    resetButtonRef.current?.focus();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {regions ? (
        <details className="rounded-card border border-border p-3 sm:p-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Parts of the picture ({t.regions.length}): fill with the keyboard</summary>
          <p className="mt-2 text-meta text-text-secondary">Choose a color above, then choose a part to fill it. The part is outlined in the picture while it&apos;s focused.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2" onMouseLeave={() => setHighlight(null)}>
            {t.regions.map((r) => {
              const fill = doc.fills[r.id];
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => fillPart(r.id)}
                    onFocus={() => setHighlight(r.id)}
                    onBlur={() => setHighlight(null)}
                    onMouseEnter={() => setHighlight(r.id)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-tile border border-border bg-surface px-3 py-2 text-left hover:border-border-strong focus-visible:outline-3 focus-visible:outline-primary"
                  >
                    <span className="size-6 shrink-0 rounded-full border-2 border-border-strong" style={{ background: fill ? colorHex(fill) : "#fff" }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{r.label}</span>
                      <span className="block text-meta text-text-secondary">{fill ? colorLabel(fill) : "Not colored yet"}</span>
                    </span>
                    <span className="sr-only">. Fill with {colorLabel(color)}.</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

function ToggleButton({ pressed, onClick, children, className, disabled, title }: { pressed: boolean; onClick: () => void; children: ReactNode; className?: string; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "relative inline-flex min-h-12 items-center justify-center gap-1.5 rounded-tile border-2 px-2 py-2 text-meta font-semibold",
        "motion-safe:transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50",
        pressed ? "border-primary bg-primary-soft text-text shadow-[inset_0_0_0_1px_var(--color-primary)]" : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
        className,
      )}
    >
      {children}
      {pressed ? (
        <span className="absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-on-primary" aria-hidden="true">
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

function Thumb({ t, doc, lineArtUrl }: { t: ColoringTemplate; doc: ColoringDoc; lineArtUrl?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paths = useMemo(() => regionPaths(t), [t]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = 0.5;
    c.width = Math.round(t.width * k);
    c.height = Math.round(t.height * k);
    const ctx = c.getContext("2d");
    if (ctx) paintStrokes(ctx, doc, paths, k);
  }, [doc, paths, t]);
  return (
    <div className="relative overflow-hidden rounded-tile border border-border bg-white" style={{ aspectRatio: `${t.width} / ${t.height}` }}>
      <ColoringFills t={t} fills={doc.fills} className="absolute inset-0 size-full" />
      <canvas ref={ref} className="absolute inset-0 size-full" aria-hidden="true" />
      <ColoringLines t={t} lineArtUrl={lineArtUrl} className="absolute inset-0 size-full" />
    </div>
  );
}

function ChoicePanel({
  title,
  t,
  lineArtUrl,
  left,
  right,
  actions,
  alert,
}: {
  title: string;
  t: ColoringTemplate;
  lineArtUrl?: string | null;
  left: { label: string; doc: ColoringDoc };
  right: { label: string; doc: ColoringDoc };
  actions: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className="rounded-card border border-primary bg-primary-soft p-3 text-meta" role={alert ? "alert" : "region"} aria-label={alert ? undefined : "Unsaved coloring on this device"}>
      <p className="font-semibold">{title}</p>
      <p className="text-text-secondary">Choose which to keep. Nothing is lost until you choose.</p>
      <div className="mt-2 grid max-w-xl grid-cols-2 gap-3">
        {[left, right].map((x) => (
          <div key={x.label}>
            <p className="mb-1 font-semibold">{x.label}</p>
            <Thumb t={t} doc={x.doc} lineArtUrl={lineArtUrl} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}
