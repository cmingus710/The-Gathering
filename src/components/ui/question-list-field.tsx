"use client";

import { ArrowDown, ArrowUp, CircleAlert, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { fieldControlClass } from "./field";

type Item = { key: string; text: string };
type Focus = { key: string; target: "text" | "up" | "down" } | { key: null; target: "add" };

/** A textarea that grows with its text, so long questions and paragraphs show in full while editing. */
function GrowingTextarea({ value, className, ...rest }: React.ComponentProps<"textarea"> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);
  return <textarea ref={ref} rows={2} value={value} className={cn(fieldControlClass, "resize-none overflow-hidden leading-relaxed", className)} {...rest} />;
}

/**
 * An editable list of questions: one growing text box per question, with
 * Add question, Move up/down, and Remove. Each box is submitted as its own
 * `name` entry, in order (read them with readQuestions); empty boxes are
 * ignored when saving. Text is kept in state, so it survives a failed save.
 */
export function QuestionListField({
  label,
  name,
  initial,
  max,
  maxLength,
  hint,
  error,
  optional,
}: {
  label: string;
  name: string;
  initial: string[];
  max: number;
  maxLength: number;
  hint?: React.ReactNode;
  error?: string[] | string;
  optional?: boolean;
}) {
  const base = useId();
  const next = useRef(Math.max(initial.length, 1));
  const [items, setItems] = useState<Item[]>(() => (initial.length ? initial : [""]).map((text, i) => ({ key: `q${i}`, text })));
  const [status, setStatus] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const focus = useRef<Focus | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const message = Array.isArray(error) ? error[0] : error;
  const full = items.length >= max;
  const ids = { hint: `${base}-hint`, error: `${base}-error`, add: `${base}-add` };
  const elId = (key: string, target: "text" | "up" | "down") => `${base}-${key}-${target}`;

  // Moves focus after the list re-renders (to a new box, a moved question's button, or Add question).
  useEffect(() => {
    const f = focus.current;
    if (!f) return;
    focus.current = null;
    const el = f.key === null ? document.getElementById(ids.add) : document.getElementById(elId(f.key, f.target));
    const fallback = f.key === null ? null : document.getElementById(elId(f.key, "text"));
    const target = el && !(el as HTMLButtonElement).disabled ? el : (fallback ?? document.getElementById(ids.add));
    target?.focus();
  });

  const add = () => {
    if (full) return;
    const key = `q${next.current++}`;
    focus.current = { key, target: "text" };
    setItems((list) => [...list, { key, text: "" }]);
    setStatus(`Question ${items.length + 1} added.`);
  };

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const list = [...items];
    [list[i], list[j]] = [list[j], list[i]];
    focus.current = { key: items[i].key, target: by < 0 ? "up" : "down" };
    setItems(list);
    setStatus(`Question ${i + 1} moved to position ${j + 1}.`);
  };

  const remove = (key: string) => {
    const i = items.findIndex((it) => it.key === key);
    if (i < 0) return;
    const list = items.filter((it) => it.key !== key);
    const after = list[i] ?? list[i - 1];
    focus.current = after ? { key: after.key, target: "text" } : { key: null, target: "add" };
    setItems(list);
    setStatus(`Question ${i + 1} removed.${list.length ? ` ${list.length} ${list.length === 1 ? "question" : "questions"} left.` : ""}`);
  };

  const askRemove = (it: Item) => {
    if (!it.text.trim()) return remove(it.key);
    setRemoving(it.key);
    dialog.current?.showModal();
  };

  const removingIndex = items.findIndex((it) => it.key === removing);
  const preview = removingIndex >= 0 ? items[removingIndex].text.trim() : "";

  return (
    <fieldset className="space-y-3" aria-describedby={[hint ? ids.hint : null, message ? ids.error : null].filter(Boolean).join(" ") || undefined}>
      <legend className="font-semibold text-text">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-text-secondary">(optional)</span> : null}
      </legend>
      {hint ? (
        <p id={ids.hint} className="-mt-1.5 text-meta text-text-secondary">
          {hint}
        </p>
      ) : null}

      {items.length ? (
        <ol className="space-y-3">
          {items.map((it, i) => {
            const textId = elId(it.key, "text");
            const tooLong = it.text.length > maxLength;
            const near = it.text.length > maxLength * 0.8;
            return (
              <li key={it.key} className="space-y-1.5 rounded-tile border border-border bg-surface-muted/40 p-3 sm:p-4">
                <label htmlFor={textId} className="block font-semibold text-text">
                  Question {i + 1}
                </label>
                <GrowingTextarea
                  id={textId}
                  name={name}
                  value={it.text}
                  maxLength={tooLong ? undefined : maxLength}
                  onChange={(e) => {
                    const text = e.target.value;
                    setItems((list) => list.map((x) => (x.key === it.key ? { ...x, text } : x)));
                  }}
                  aria-invalid={tooLong || message ? true : undefined}
                  aria-describedby={[near ? `${textId}-count` : null, message ? ids.error : null].filter(Boolean).join(" ") || undefined}
                  className={tooLong ? "border-danger" : "border-border-strong"}
                />
                {near ? (
                  <p id={`${textId}-count`} className={cn("text-meta", tooLong ? "font-medium text-danger" : "text-text-secondary")}>
                    {tooLong
                      ? `${it.text.length.toLocaleString("en-US")} characters. Shorten this question to ${maxLength.toLocaleString("en-US")} or fewer to save.`
                      : `${it.text.length.toLocaleString("en-US")} of ${maxLength.toLocaleString("en-US")} characters`}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  <Button
                    id={elId(it.key, "up")}
                    variant="ghost"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`Move question ${i + 1} up`}
                    icon={<ArrowUp className="size-4" aria-hidden="true" />}
                  >
                    Move up
                  </Button>
                  <Button
                    id={elId(it.key, "down")}
                    variant="ghost"
                    size="sm"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Move question ${i + 1} down`}
                    icon={<ArrowDown className="size-4" aria-hidden="true" />}
                  >
                    Move down
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => askRemove(it)} aria-label={`Remove question ${i + 1}`} icon={<Trash2 className="size-4" aria-hidden="true" />} aria-haspopup={it.text.trim() ? "dialog" : undefined}>
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-text-secondary">No questions. Add one, or leave it empty.</p>
      )}

      {message ? (
        <p id={ids.error} className="flex items-start gap-1.5 text-meta font-medium text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="sr-only">Error: </span>
            {message}
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button id={ids.add} variant="secondary" size="sm" onClick={add} disabled={full} icon={<Plus className="size-4" aria-hidden="true" />}>
          Add Question
        </Button>
        <span className="text-meta text-text-secondary">{full ? `That's the most this allows (${max}).` : `Up to ${max}. Empty boxes are left out when you save.`}</span>
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>

      <dialog
        ref={dialog}
        aria-labelledby={`${base}-confirm-title`}
        aria-describedby={`${base}-confirm-body`}
        onClose={() => setRemoving(null)}
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-6 text-text shadow-(--elev-lift) backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
      >
        <h2 id={`${base}-confirm-title`} className="font-display text-xl font-semibold">
          Remove question {removingIndex + 1}?
        </h2>
        <div id={`${base}-confirm-body`} className="mt-2 space-y-2 text-text-secondary">
          <p>Its text will be removed from this form. Nothing changes for members until you save.</p>
          {preview ? <p className="line-clamp-4 whitespace-pre-line border-l-2 border-border-strong pl-3 [overflow-wrap:anywhere]">{preview}</p> : null}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => dialog.current?.close()} autoFocus>
            Keep it
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              const key = removing;
              dialog.current?.close();
              if (key) remove(key);
            }}
          >
            Remove question
          </Button>
        </div>
      </dialog>
    </fieldset>
  );
}
