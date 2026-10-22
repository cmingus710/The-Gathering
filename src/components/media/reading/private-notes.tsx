"use client";

import { Lock, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { JournalEditor } from "@/components/journal/editor";
import { Button } from "@/components/ui/button";
import type { PlanNote } from "@/lib/media/reading-plan";

type Target = { id: string; label: string };

function about(note: PlanNote, bookId: string): string {
  const l = note.link;
  if (!l) return "";
  if (l.kind === "book") return "About the book";
  if (!l.available || !l.title) return "About an assignment that's no longer available";
  return l.item_id === bookId ? "About the book" : `About ${l.title}`;
}

/**
 * The member's own notes about this book and its assignments (they live in
 * My Journal, private to the member), and an inline editor that autosaves a
 * new note linked to the book or one assignment. Nothing here is visible to
 * teachers, administrators, guardians, or other members.
 */
export function PrivateNotes({
  bookId,
  notes,
  assignments,
  defaultTarget,
  assignmentNotes,
}: {
  bookId: string;
  notes: PlanNote[];
  /** Assignments a note can be about (in the plan being shown). */
  assignments: Target[];
  /** The selected or current assignment, preselected in "About". */
  defaultTarget: string | null;
  /** False until the database accepts notes linked to an assignment. */
  assignmentNotes: boolean;
}) {
  const selectId = useId();
  const [target, setTarget] = useState<string>(assignmentNotes && defaultTarget ? defaultTarget : "book");
  const [writing, setWriting] = useState<string | null>(null);
  const options: Target[] = [{ id: "book", label: "The book" }, ...(assignmentNotes ? assignments : [])];
  const link =
    writing === "book" ? { kind: "book", media_item_id: bookId } : writing ? { kind: "book_assignment", media_item_id: writing } : null;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-meta text-text-secondary">
        <Lock className="size-4" aria-hidden="true" />
        Only you can see these. They&apos;re kept in{" "}
        <Link href="/journal" className="font-semibold text-primary hover:underline">
          My Journal
        </Link>
        .
      </p>
      {notes.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {notes.map((n) => (
            <li key={n.id}>
              <Link href={`/journal/${n.id}`} className="interactive block px-4 py-3 hover:bg-surface-muted/60">
                <span className="block font-semibold">{n.title || "Untitled"}</span>
                <span className="block text-meta text-primary">{about(n, bookId)}</span>
                {n.excerpt ? <span className="mt-0.5 block truncate text-meta text-text-secondary">{n.excerpt}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {writing ? (
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="mb-2 text-meta font-semibold text-text-secondary">
            New note {writing === "book" ? "about the book" : `about ${options.find((o) => o.id === writing)?.label ?? "this assignment"}`}
          </p>
          <JournalEditor entry={null} link={link} inline placeholder="Write freely. Only you can see this." />
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          {options.length > 1 ? (
            <div>
              <label htmlFor={selectId} className="mb-1 block text-meta font-semibold">
                About
              </label>
              <select
                id={selectId}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="min-h-11 max-w-full rounded-control border border-border-strong/60 bg-surface px-3 sm:max-w-sm"
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Button variant="secondary" onClick={() => setWriting(target)} icon={<NotebookPen className="size-4" aria-hidden="true" />}>
            Write privately
          </Button>
        </div>
      )}
    </div>
  );
}
