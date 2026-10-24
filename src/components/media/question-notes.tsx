"use client";

import { CheckCircle2, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { fieldControlClass } from "@/components/ui/field";
import { NOTE_MAX, notesJournalBody } from "@/lib/media/question-notes";
import { questionId } from "@/lib/questions";

/** What a journal entry from these notes links to (null: an unlinked entry). */
export type NotesLink = { kind: "devotional" | "lesson" | "book_assignment"; media_item_id: string } | null;

function NoteBox({ value, ...rest }: React.ComponentProps<"textarea"> & { value: string }) {
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
  return <textarea ref={ref} rows={3} value={value} className={cn(fieldControlClass, "resize-none overflow-hidden border-border-strong leading-relaxed")} {...rest} />;
}

/**
 * A content item's questions, each in its own section. Signed-in members get
 * a notes box under each question and "Send to My Journal", which saves the
 * questions with their notes as one private journal entry. Notes live in
 * memory only (never in browser storage), like the journal editor.
 */
export function QuestionNotes({
  questions,
  title,
  link,
  canNote,
  headingLevel: H = "h3",
}: {
  questions: string[];
  title: string;
  link: NotesLink;
  canNote: boolean;
  headingLevel?: "h3" | "h4" | "h5";
}) {
  const base = useId();
  // Keyed by the question's stable id, so a note stays with its question.
  const keys = questions.map((q, i) => `${questionId(q)}-${questions.slice(0, i).filter((p) => p === q).length}`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: string; body: string } | null>(null);
  const clientKey = useRef<string | null>(null);

  const body = notesJournalBody(questions.map((q, i) => ({ question: q, note: notes[keys[i]] ?? "" })));
  const written = questions.some((_, i) => (notes[keys[i]] ?? "").trim());
  const unsent = written && body !== sent?.body;

  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  async function send() {
    if (!written || busy) return;
    setBusy(true);
    setError(null);
    // One key per text sent, so a retried send never makes two entries.
    clientKey.current ??= crypto.randomUUID();
    try {
      const res = await fetch("/api/journal/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_key: clientKey.current, title: `Notes: ${title}`.slice(0, 200), body, link }),
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.ok && data.id) {
        setSent({ id: data.id, body });
        clientKey.current = null;
      } else setError(data.error ?? "Your notes couldn't be sent. They're still here; try again.");
    } catch {
      setError("The connection was interrupted. Your notes are still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {questions.map((q, i) => {
          const key = keys[i];
          const note = notes[key] ?? "";
          const noteId = `${base}-note-${i}`;
          const near = note.length > NOTE_MAX * 0.8;
          return (
            <li key={key} className="rounded-tile border border-border bg-background p-4">
              <section aria-labelledby={`${base}-q-${i}`} className="space-y-3">
                <H id={`${base}-q-${i}`} className="flex gap-2 font-semibold leading-relaxed">
                  <span className="shrink-0 text-text-secondary">{i + 1}.</span>
                  <span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere] [text-wrap:pretty]">{q}</span>
                </H>
                {canNote ? (
                  <div className="space-y-1.5">
                    <label htmlFor={noteId} className="block text-meta font-semibold text-text-secondary">
                      Your notes<span className="sr-only"> on question {i + 1}</span>
                    </label>
                    <NoteBox
                      id={noteId}
                      value={note}
                      maxLength={NOTE_MAX}
                      placeholder="Write your thoughts…"
                      aria-describedby={near ? `${noteId}-count` : undefined}
                      onChange={(e) => {
                        const text = e.target.value;
                        setNotes((n) => ({ ...n, [key]: text }));
                      }}
                    />
                    {near ? (
                      <p id={`${noteId}-count`} className="text-meta text-text-secondary">
                        {note.length.toLocaleString("en-US")} of {NOTE_MAX.toLocaleString("en-US")} characters
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </li>
          );
        })}
      </ol>

      {canNote ? (
        <div className="space-y-3">
          {error ? <Alert tone="error" title={error} live /> : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              onClick={send}
              disabled={!unsent}
              loading={busy}
              loadingText="Sending…"
              icon={sent && !unsent ? <CheckCircle2 className="size-5" aria-hidden="true" /> : <NotebookPen className="size-5" aria-hidden="true" />}
            >
              {sent && !unsent ? "Sent to My Journal" : sent ? "Send again as a new entry" : "Send to My Journal"}
            </Button>
            {sent ? (
              <Link href={`/journal/${sent.id}`} className="font-semibold text-primary hover:underline">
                Open in My Journal
              </Link>
            ) : null}
          </div>
          <p role="status" className="text-meta text-text-secondary">
            {sent && !unsent
              ? "Saved as a private journal entry with these questions and your notes."
              : written
                ? "Only you can see your journal. Notes aren't kept on this page until you send them."
                : "Write a note under any question, then send them all to My Journal (private to you)."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
