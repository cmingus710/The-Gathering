"use client";

import { ExternalLink, Link2, Link2Off, Pencil } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { TextAreaField, TextField } from "@/components/ui/field";
import { encodeDestination, hasHtmlLinks, htmlToMarkdown, linkAt, markdownLink, pastedAddress, type LinkSpan } from "@/lib/links/markdown";
import { classifyHref, describeHref, normalizeLinkInput } from "@/lib/links/policy";
import { registerUnsaved } from "./unsaved";

type Range = { start: number; end: number };

type DialogState = {
  mode: "insert" | "edit";
  /** The text the link replaces (the selection, or the whole link being edited). */
  range: Range;
  /** The selection when the dialog opened, put back on Cancel. */
  restore: Range;
  text: string;
  href: string;
  /** For an edited link: its text as written, kept as is when the text isn't changed. */
  rawText?: string;
};

export type LinkToolsOptions = {
  /** False turns link editing and paste handling off for this box. */
  enabled?: boolean;
  /** Text ranges links must not change (the names of @mentions): a selection touching one is never wrapped. */
  protectedRanges?: () => Range[];
};

export type LinkTools = {
  /** Opens the link dialog: to edit the link at the caret, or to insert one (from the selection, if any). */
  open: () => void;
  /** The link the caret is in while the text box (or the link bar) has focus. */
  active: LinkSpan | null;
  /** The Edit / Open / Remove bar for that link; place it right after the text box. */
  bar: ReactNode;
  /** The dialog (rendered in a portal, so it never sits inside the surrounding form). */
  dialog: ReactNode;
};

function origins(): string[] {
  return typeof window === "undefined" ? [] : [window.location.origin];
}

/**
 * Replaces part of a text box's value the way typing would, so the browser's
 * own undo and redo include it and React's onChange sees it: through
 * execCommand("insertText") where supported, otherwise setRangeText and an
 * input event. The caret ends after the new text.
 */
export function replaceRange(el: HTMLTextAreaElement, start: number, end: number, text: string) {
  el.focus({ preventScroll: true });
  el.setSelectionRange(start, end);
  let done = false;
  try {
    done = text ? document.execCommand("insertText", false, text) : document.execCommand("delete");
  } catch {
    done = false;
  }
  if (!done || el.value.slice(start, start + text.length) !== text) {
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function overlaps(r: Range, ranges: Range[]): boolean {
  return ranges.some((p) => r.start < p.end && r.end > p.start);
}

/**
 * Easy hyperlinks for a Markdown text box, shared by every editor that
 * writes links (announcements, devotionals and lessons, lesson blocks,
 * Community posts and comments, prayer requests, updates, and comments):
 *
 * - `open()` (the toolbar's Link button, or Ctrl/⌘+K in the box) asks for
 *   the text to show (prefilled from the selection) and the address, and
 *   inserts `[text](address)` in place of the selection. Formatting inside
 *   the selection is kept. With nothing selected, the address is the text.
 * - With the caret in a link, a bar under the box offers Edit, Open (in a
 *   new tab, so nothing being written is lost), and Remove link (the text
 *   stays). Buttons keep the caret and on-screen keyboard where they were.
 * - Pasting an address over selected text links that text; a standalone
 *   web address pastes as itself and shows as a link once published;
 *   pasted HTML with links becomes the same Markdown (anything else in it
 *   is dropped). Only the paste event's own data is read, so no clipboard
 *   permission is asked for.
 * - Every change goes through the browser's undo history.
 * - Addresses are checked with the shared link policy; the server checks
 *   them again on save.
 */
export function useLinkTools(ref: RefObject<HTMLTextAreaElement | null>, options: LinkToolsOptions = {}): LinkTools {
  const [active, setActive] = useState<LinkSpan | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  const dialogOpen = useRef(false);
  // The selection as last seen while the box had focus: a tap on a button can
  // blur the box (and on some phones collapse its selection) before the click.
  const lastSelection = useRef<Range | null>(null);
  const key = useId();
  const enabled = options.enabled !== false;
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  useEffect(() => {
    dialogOpen.current = dialog !== null;
  }, [dialog]);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) lastSelection.current = { start: el.selectionStart, end: el.selectionEnd };
    const focused = document.activeElement === el || !!barRef.current?.contains(document.activeElement);
    const span = focused && !dialogOpen.current ? linkAt(el.value, el.selectionStart, el.selectionEnd) : null;
    setActive((prev) => (prev?.start === span?.start && prev?.end === span?.end && prev?.href === span?.href && prev?.text === span?.text ? prev : span));
  }, [ref]);

  const open = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const seen = lastSelection.current;
    const restore =
      document.activeElement !== el && seen && seen.end <= el.value.length ? { ...seen } : { start: el.selectionStart, end: el.selectionEnd };
    const span = linkAt(el.value, restore.start, restore.end);
    if (span) {
      setDialog({ mode: "edit", range: { start: span.start, end: span.end }, restore, text: span.bare ? "" : span.text, rawText: span.bare ? undefined : span.rawText, href: span.href });
      return;
    }
    // Link the selected words, not the spaces around them.
    let { start, end } = restore;
    while (start < end && /\s/.test(el.value[start])) start++;
    while (end > start && /\s/.test(el.value[end - 1])) end--;
    if (overlaps({ start, end }, optionsRef.current.protectedRanges?.() ?? [])) start = end = restore.end;
    const selected = el.value.slice(start, end);
    const address = pastedAddress(selected);
    setDialog({ mode: "insert", range: { start, end }, restore, text: address ? "" : selected.replace(/\s*\n\s*/g, " "), href: address ? selected : "" });
  }, [ref]);

  // Selection tracking, Ctrl/⌘+K, and paste, on the text box itself.
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    // Runs after the event, never inside it: a state update from this
    // (native) listener would otherwise re-render before React's own
    // onChange and write the old controlled value back into the box,
    // undoing the edit (and the browser's undo/redo).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(sync, 0);
    };
    const onSelectionChange = () => {
      if (document.activeElement === el) later();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data) return;
      const plain = data.getData("text/plain");
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const address = pastedAddress(plain);
      if (address) {
        const link = classifyHref(address, origins());
        const selected = el.value.slice(start, end);
        const wrappable =
          selected.trim() && !selected.includes("\n") && !pastedAddress(selected) && !linkAt(el.value, start, end) && !overlaps({ start, end }, optionsRef.current.protectedRanges?.() ?? []);
        if (link && wrappable) {
          e.preventDefault();
          const lead = selected.length - selected.trimStart().length;
          const trail = selected.length - selected.trimEnd().length;
          replaceRange(el, start, end, `${selected.slice(0, lead)}${markdownLink(selected.trim(), link.href)}${selected.slice(selected.length - trail)}`);
        } else if (link && link.kind === "email") {
          // "mailto:…" on its own wouldn't show as a link; give it the address as its text.
          e.preventDefault();
          replaceRange(el, start, end, markdownLink("", link.href));
        }
        // A standalone web address pastes as typed; it shows as a link when published.
        return;
      }
      const html = data.getData("text/html");
      if (html && hasHtmlLinks(html)) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const markdown = htmlToMarkdown(doc.body, origins());
        if (markdown) {
          e.preventDefault();
          replaceRange(el, start, end, markdown);
        }
      }
    };
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("paste", onPaste);
    for (const type of ["select", "keyup", "click", "input", "focus"]) el.addEventListener(type, later);
    el.addEventListener("blur", later);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("paste", onPaste);
      for (const type of ["select", "keyup", "click", "input", "focus"]) el.removeEventListener(type, later);
      el.removeEventListener("blur", later);
      document.removeEventListener("selectionchange", onSelectionChange);
      clearTimeout(timer);
    };
  }, [ref, sync, open, enabled]);

  // Unsaved text here makes links in rendered content open in a new tab.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const initial = el.value;
    return registerUnsaved(key, () => el.isConnected && el.value.trim() !== initial.trim());
  }, [ref, key]);

  const finish = (state: DialogState, result: { text: string; href: string } | null) => {
    setDialog(null);
    dialogOpen.current = false;
    const el = ref.current;
    if (!el) return;
    if (!result) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(state.restore.start, state.restore.end);
      return;
    }
    const label = result.text.trim();
    const unchangedText = state.mode === "edit" && state.rawText !== undefined && label === state.text.trim();
    const replacement = unchangedText ? `[${state.rawText}](${encodeDestination(result.href)})` : markdownLink(label || result.text, result.href);
    if (el.value.slice(state.range.start, state.range.end) === replacement) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(state.range.end, state.range.end);
      return;
    }
    replaceRange(el, state.range.start, state.range.end, replacement);
  };

  const remove = (span: LinkSpan) => {
    const el = ref.current;
    if (!el || span.bare) return;
    replaceRange(el, span.start, span.end, span.rawText);
  };

  const link = active ? classifyHref(active.href, origins()) : null;
  const newTab = link?.kind === "web" || link?.kind === "internal";
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const barButton = "inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 font-semibold text-primary hover:bg-primary-soft focus-visible:outline-3 focus-visible:outline-primary";

  const bar = active ? (
    <div
      ref={barRef}
      role="group"
      aria-label="Link"
      onBlur={() => setTimeout(sync, 0)}
      className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1 rounded-control border border-border bg-surface-muted py-0.5 pl-2.5 pr-1 text-meta"
    >
      <span className="flex min-w-0 flex-1 basis-40 items-center gap-1.5 py-1">
        <Link2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 truncate">
          <span className="font-semibold">{active.bare ? "Web address" : active.text}</span>
          <span className="text-text-secondary"> → {link ? describeHref(link) : "This address can't be used"}</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center">
        <button type="button" onMouseDown={keep} onClick={open} className={barButton} aria-haspopup="dialog">
          <Pencil className="size-4" aria-hidden="true" />
          Edit<span className="sr-only"> link</span>
        </button>
        {link ? (
          <a href={link.href} onMouseDown={keep} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={barButton}>
            <ExternalLink className="size-4" aria-hidden="true" />
            Open<span className="sr-only"> link{newTab ? " (opens in a new tab)" : ""}</span>
          </a>
        ) : null}
        {!active.bare ? (
          <button type="button" onMouseDown={keep} onClick={() => remove(active)} className={barButton}>
            <Link2Off className="size-4" aria-hidden="true" />
            Remove link
          </button>
        ) : null}
      </span>
    </div>
  ) : null;

  const dialogNode = dialog ? createPortal(<LinkDialog state={dialog} onDone={(r) => finish(dialog, r)} />, document.body) : null;

  return { open, active, bar, dialog: dialogNode };
}

/** The toolbar button: icon-only (`tool`, next to other formatting tools) or icon and word (`chip`). */
export function LinkButton({ tools, variant = "chip", className }: { tools: LinkTools; variant?: "tool" | "chip"; className?: string }) {
  const label = tools.active ? "Edit link" : "Insert link";
  return (
    <button
      type="button"
      // Keep focus and the selection in the text box (and the keyboard open on phones).
      onMouseDown={(e) => e.preventDefault()}
      onClick={tools.open}
      aria-haspopup="dialog"
      aria-label={label}
      aria-keyshortcuts="Control+K Meta+K"
      title={`${label} (Ctrl+K)`}
      className={cn(
        variant === "tool"
          ? "flex size-11 items-center justify-center rounded-control border border-border-strong bg-surface hover:bg-primary-soft"
          : "inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-meta font-semibold text-primary hover:bg-primary-soft",
        "focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary",
        className,
      )}
    >
      <Link2 className="size-4" aria-hidden="true" />
      {variant === "chip" ? <span aria-hidden="true">{tools.active ? "Edit link" : "Link"}</span> : null}
    </button>
  );
}

/**
 * A TextAreaField with a formatting toolbar (any `tools` passed, then the
 * Link button) between its label and the box, and the link bar under the
 * box: the editor for announcements, devotionals, lessons, and lesson blocks.
 */
export function LinkTextAreaField({
  tools: extraTools,
  toolbarLabel = "Formatting",
  ref: outerRef,
  ...field
}: ComponentProps<typeof TextAreaField> & { tools?: ReactNode; toolbarLabel?: string }) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const tools = useLinkTools(inner);
  const fieldId = field.id ?? `field-${field.name}`;
  const setRef = (el: HTMLTextAreaElement | null) => {
    inner.current = el;
    if (typeof outerRef === "function") outerRef(el);
    else if (outerRef) outerRef.current = el;
  };
  return (
    <>
      <TextAreaField
        {...field}
        ref={setRef}
        before={
          <div role="toolbar" aria-label={toolbarLabel} aria-controls={fieldId} className="flex flex-wrap gap-1">
            {extraTools}
            <LinkButton tools={tools} variant="tool" />
          </div>
        }
        after={tools.bar}
      />
      {tools.dialog}
    </>
  );
}

function LinkDialog({ state, onDone }: { state: DialogState; onDone: (result: { text: string; href: string } | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(state.text);
  const [href, setHref] = useState(state.href);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const id = useId();
  const editing = state.mode === "edit";

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    urlRef.current?.focus();
    if (editing) urlRef.current?.select();
  }, [editing]);

  const close = (result: { text: string; href: string } | null) => {
    if (done.current) return;
    done.current = true;
    ref.current?.close();
    onDone(result);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        close(null);
      }}
      onClose={() => close(null)}
      className="mx-auto mb-auto mt-[max(1rem,env(safe-area-inset-top))] max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100%-2rem))] overflow-y-auto rounded-card border border-border bg-surface p-5 text-text shadow-(--elev-lift) backdrop:bg-black/50 backdrop:backdrop-blur-[2px] sm:mt-[12vh] sm:p-6"
    >
      <h2 id={`${id}-title`} className="font-display text-xl font-semibold">
        {editing ? "Edit link" : "Insert link"}
      </h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          // The dialog is portalled, but React still bubbles submit to the surrounding form's handlers.
          e.stopPropagation();
          const result = normalizeLinkInput(href, origins());
          if (!result.ok) {
            setError(result.error);
            urlRef.current?.focus();
            return;
          }
          close({ text: text.trim() ? text : href.trim(), href: result.href });
        }}
        className="mt-4 space-y-4"
      >
        <TextField
          id={`${id}-text`}
          name="link-text"
          label="Text to show"
          optional
          value={text}
          onChange={(e) => setText(e.target.value)}
          hint="Leave empty to show the address itself."
          autoComplete="off"
          maxLength={500}
        />
        <TextField
          ref={urlRef}
          id={`${id}-href`}
          name="link-address"
          label="Link address"
          value={href}
          onChange={(e) => {
            setHref(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
          hint="A web address, a page in The Gathering (such as /events), an email address, or a phone number."
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          maxLength={2000}
          placeholder="https://…"
        />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" icon={<Link2 className="size-4" aria-hidden="true" />}>
            {editing ? "Save link" : "Insert link"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
