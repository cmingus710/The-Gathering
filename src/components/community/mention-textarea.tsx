"use client";

import { AtSign, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { mentionSuggestionsAction } from "@/app/(app)/(member)/community/mention-actions";
import { cn } from "@/components/ui/cn";
import { MemberAvatar } from "@/components/profile/member-avatar";
import {
  applyTextEdit,
  findMentionQuery,
  insertMention,
  MENTION_LIMIT,
  mentionedPeople,
  parseMentions,
  removeMention,
  serializeMentions,
  type Mention,
  type MentionSuggestion,
} from "@/lib/community/mentions";
import { AutoGrowTextarea } from "./feed-bits";

/** Where the text will be posted, which decides who can be mentioned. */
export type MentionPlace = { threadId: string } | { categoryId: string | null; groupId: string | null };

type Props = Omit<ComponentProps<"textarea">, "value" | "onChange" | "name" | "defaultValue"> & {
  /** Form field that carries the text with its mentions (`@[Name](mention:<id>)`). */
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  place: MentionPlace | null;
  minRows?: number;
};

/**
 * A comment or post box with @mentions. Typing "@" and part of a name opens
 * a list of members who can be mentioned here (from the server, at most 8);
 * arrow keys and Enter or Tab choose, Escape closes, and a tap works the
 * same. The member keeps editing plain text ("@Ann Rivers"); the chosen
 * people are listed under the box, each with a remove button, and Backspace
 * into a name removes the whole mention. The form gets the text with the
 * mention markup in a hidden field; the server checks every mention again.
 */
export function MentionTextarea({ name, value, onValueChange, place, minRows, className, ref: outerRef, onKeyDown, ...rest }: Props) {
  const { text, mentions } = useMemo(() => parseMentions(value), [value]);
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [query, setQuery] = useState<{ start: number; query: string; caret: number } | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  // The latest answer from the server, for the query it answered.
  const [answer, setAnswer] = useState<{ key: string; items: MentionSuggestion[] }>({ key: "", items: [] });
  const [active, setActive] = useState(0);
  const id = useId();
  const listId = `${id}-mentions`;
  const people = mentionedPeople(mentions);
  const atLimit = people >= MENTION_LIMIT;
  const placeKey = place ? ("threadId" in place ? `t:${place.threadId}` : `p:${place.categoryId ?? ""}:${place.groupId ?? ""}`) : "";
  const open = !!query && query.start !== dismissed && !!place;

  const setRefs = (el: HTMLTextAreaElement | null) => {
    inner.current = el;
    if (typeof outerRef === "function") outerRef(el);
    else if (outerRef) outerRef.current = el;
  };

  // Put the caret where an insert or removal left it.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret == null || !inner.current) return;
    pendingCaret.current = null;
    inner.current.setSelectionRange(caret, caret);
  }, [value]);

  // Ask the server for people matching what's typed (debounced; an answer
  // only shows while it still matches the query).
  const q = open && !atLimit ? query.query : "";
  const key = q ? `${placeKey}|${q}` : "";
  const results = key && answer.key === key ? answer.items : [];
  const loading = !!key && answer.key !== key;
  useEffect(() => {
    if (!key || !place) return;
    let current = true;
    const timer = setTimeout(async () => {
      const items = await mentionSuggestionsAction({ query: q, ...place }).catch(() => [] as MentionSuggestion[]);
      if (!current) return;
      setAnswer({ key, items });
      setActive(0);
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // place is compared through `key`, so a new object for the same place doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const track = (el: HTMLTextAreaElement, current = text, currentMentions: Mention[] = mentions) => {
    const caret = el.selectionStart ?? current.length;
    const found = el.selectionStart === el.selectionEnd ? findMentionQuery(current, caret, currentMentions) : null;
    setQuery(found ? { ...found, caret } : null);
    if (!found) setDismissed(null);
  };

  const commit = (next: { text: string; mentions: Mention[] }, caret?: number) => {
    if (caret != null) pendingCaret.current = caret;
    onValueChange(serializeMentions(next.text, next.mentions));
  };

  const choose = (person: MentionSuggestion) => {
    if (!query) return;
    const next = insertMention(text, mentions, { start: query.start, end: query.caret }, person);
    commit(next, next.caret);
    setQuery(null);
    inner.current?.focus();
  };

  const options = open && !atLimit ? results : [];
  const activeId = options.length ? `${listId}-${Math.min(active, options.length - 1)}` : undefined;
  const status = !open
    ? ""
    : atLimit
      ? `You can mention up to ${MENTION_LIMIT} people.`
      : loading
        ? ""
        : options.length
          ? `${options.length} ${options.length === 1 ? "person" : "people"} found. Use the up and down arrows, then Enter to mention.`
          : "No one to mention by that name here.";

  return (
    <div className="relative min-w-0 flex-1">
      <input type="hidden" name={name} value={value} />
      <AutoGrowTextarea
        {...rest}
        ref={setRefs}
        minRows={minRows}
        className={className}
        value={text}
        // A multi-line text box keeps its textbox role; the list is tied to it
        // with aria-controls and the highlighted person with aria-activedescendant.
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={activeId}
        onChange={(e) => {
          const next = applyTextEdit(text, e.target.value, mentions);
          const caret = next.text === e.target.value ? undefined : firstDifference(e.target.value, next.text);
          commit(next, caret);
          track(e.target, next.text, next.mentions);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onKeyDown={(e) => {
          if (options.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(options[Math.min(active, options.length - 1)]);
              return;
            }
          }
          if (e.key === "Escape" && open) {
            e.preventDefault();
            setDismissed(query.start);
            return;
          }
          onKeyDown?.(e);
        }}
        onBlur={() => setQuery(null)}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="People you can mention"
        hidden={!options.length}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-(--elev-lift)"
      >
        {options.map((p, i) => (
          <li
            key={p.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            // Keep focus (and the caret) in the text box while choosing by mouse or touch.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(p)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2.5 py-1.5",
              i === active ? "bg-primary-soft text-text" : "hover:bg-surface-muted",
            )}
          >
            <MemberAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{p.name}</span>
              {p.detail ? <span className="block truncate text-[0.8125rem] text-text-secondary">{p.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {open && (atLimit || (!loading && !options.length && query.query.length > 0)) ? (
        <p className="absolute inset-x-0 top-full z-30 mt-1 rounded-card border border-border bg-surface px-3 py-2 text-meta text-text-secondary shadow-(--elev-lift)">
          {status}
        </p>
      ) : null}
      <p role="status" className="sr-only">
        {status}
      </p>
      {mentions.length ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
          <span className="text-text-secondary">Mentioning:</span>
          {mentions.map((m) => (
            <span key={`${m.id}-${m.start}`} className="inline-flex items-center gap-0.5 rounded-full bg-primary-soft py-0.5 pl-2 font-semibold text-primary">
              <AtSign className="size-3.5" aria-hidden="true" />
              {m.name}
              <button
                type="button"
                onClick={() => {
                  commit(removeMention(text, mentions, m), m.start);
                  inner.current?.focus();
                }}
                className="ml-0.5 flex size-7 items-center justify-center rounded-full hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Remove the mention of {m.name}</span>
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function firstDifference(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
