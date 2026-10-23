"use client";

/* eslint-disable @next/next/no-img-element -- short-lived signed URLs for group images */

import { AtSign, Users, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { mentionSuggestionsAction, type MentionPlace } from "@/app/(app)/(member)/mention-actions";
import { AutoGrowTextarea } from "@/components/community/feed-bits";
import { LinkButton, useLinkTools } from "@/components/links/link-tools";
import { cn } from "@/components/ui/cn";
import { MemberAvatar } from "@/components/profile/member-avatar";
import {
  applyTextEdit,
  findMentionQuery,
  GROUP_MENTION_LIMIT,
  insertMention,
  MENTION_LIMIT,
  mentionedGroups,
  mentionedPeople,
  parseMentions,
  removeMention,
  serializeMentions,
  type GroupSuggestion,
  type Mention,
  type MentionSuggestion,
  type MentionSuggestions,
} from "@/lib/community/mentions";

export type { MentionPlace };

type Props = Omit<ComponentProps<"textarea">, "value" | "onChange" | "name" | "defaultValue"> & {
  /** Form field that carries the text with its mentions (`@[Name](mention:<id>)`, `@[Name](group:<id>)`). */
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Where the text will be shared, which decides who and which groups can be mentioned. */
  place: MentionPlace | null;
  minRows?: number;
  /** Show the Link button (and link editing) under the box. On by default. */
  links?: boolean;
};

type Option = { kind: "member"; item: MentionSuggestion } | { kind: "group"; item: GroupSuggestion };

/** What choosing a group will do, in one sentence (never membership details beyond the count the author may see). */
export function groupNotice(g: Pick<GroupSuggestion, "name" | "notify" | "reach">): string {
  switch (g.notify) {
    case "notify":
      return g.reach
        ? `Notifies ${g.reach} ${g.reach === 1 ? "person" : "people"} in ${g.name} who can see this.`
        : `No one else in ${g.name} can see this, so no one will be notified.`;
    case "leaders":
      return `${g.name} is mentioned without notifying anyone: only its leaders and moderators can notify the group.`;
    case "members":
      return `${g.name} is mentioned without notifying anyone: only its members can notify the group.`;
    case "anonymous":
      return `${g.name} is mentioned without notifying anyone: groups aren't notified from anonymous posts.`;
    default:
      return `${g.name} is mentioned without notifying anyone: the group has turned off @mention notifications.`;
  }
}

/**
 * A text box with @mentions, shared by Community posts and comments and
 * prayer requests and comments. Typing "@" and part of a name opens a list
 * of the people ("Members") and groups ("Groups") that can be mentioned
 * here, from the server (at most 8 and 5); arrow keys and Enter or Tab
 * choose, Escape closes, and a tap works the same. The list opens above the
 * box when the on-screen keyboard or the bottom navigation would cover it.
 * The member keeps editing plain text ("@Ann Rivers"); chosen people and
 * groups are listed under the box, each with a remove button, and
 * Backspace into a name removes the whole mention. For a group, a short
 * note says whether it will notify anyone. The form gets the text with the
 * mention markup in a hidden field; the server checks every mention again.
 *
 * Links: the Link button under the box (or Ctrl/⌘+K) and paste add links
 * without typing any syntax, and a bar under the box edits, opens, or
 * removes the link the caret is in (see useLinkTools). Links never wrap or
 * change a mention.
 */
export function MentionTextarea({ name, value, onValueChange, place, minRows, className, ref: outerRef, onKeyDown, links = true, ...rest }: Props) {
  const { text, mentions } = useMemo(() => parseMentions(value), [value]);
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [query, setQuery] = useState<{ start: number; query: string; caret: number } | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  // The latest answer from the server, for the query it answered.
  const [answer, setAnswer] = useState<{ key: string; data: MentionSuggestions }>({ key: "", data: { members: [], groups: [] } });
  // What each chosen group will do, for the place it was chosen in (a
  // prayer request's audience can change afterwards; the note then goes).
  const [chosenInfo, setChosenInfo] = useState<{ key: string; groups: Record<string, GroupSuggestion> }>({ key: "", groups: {} });
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const [maxHeight, setMaxHeight] = useState(288);
  const id = useId();
  const listId = `${id}-mentions`;
  const peopleFull = mentionedPeople(mentions) >= MENTION_LIMIT;
  const groupsFull = mentionedGroups(mentions) >= GROUP_MENTION_LIMIT;
  const placeKey = place ? JSON.stringify(place) : "";
  const groupInfo = chosenInfo.key === placeKey ? chosenInfo.groups : {};
  const open = !!query && query.start !== dismissed && !!place;
  const linkTools = useLinkTools(inner, { protectedRanges: () => mentions, enabled: links });

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

  // Ask the server for matches (debounced; an answer only shows while it still matches the query).
  const q = open && !(peopleFull && groupsFull) ? query.query : "";
  const key = q ? `${placeKey}|${q}` : "";
  const loading = !!key && answer.key !== key;
  const data = key && answer.key === key ? answer.data : null;
  useEffect(() => {
    if (!key || !place) return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await mentionSuggestionsAction({ query: q, place }).catch(() => ({ members: [], groups: [] }) as MentionSuggestions);
      if (!current) return;
      setAnswer({ key, data: result });
      setActive(0);
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // place is compared through `key`, so a new object for the same place doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const members = data && !peopleFull ? data.members : [];
  const groups = data && !groupsFull ? data.groups : [];
  const options: Option[] = open ? [...members.map((item) => ({ kind: "member" as const, item })), ...groups.map((item) => ({ kind: "group" as const, item }))] : [];
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const activeId = options.length ? `${listId}-${activeIndex}` : undefined;
  const unavailable = data?.unavailable;

  // Keep the list inside the visible area: open it above the box when the
  // on-screen keyboard or the bottom navigation leaves too little room below.
  const showPanel = open && (options.length > 0 || (!loading && !!query?.query));
  useLayoutEffect(() => {
    if (!showPanel) return;
    const place = () => {
      const el = box.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vv = window.visualViewport;
      let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const dock = document.querySelector<HTMLElement>(".dock");
      const dockTop = dock && dock.offsetParent !== null ? dock.getBoundingClientRect().top : Infinity;
      bottom = Math.min(bottom, dockTop);
      const top = vv ? vv.offsetTop : 0;
      const below = bottom - rect.bottom - 8;
      const roomAbove = rect.top - top - 8;
      const flip = below < 180 && roomAbove > below;
      setAbove(flip);
      setMaxHeight(Math.max(120, Math.min(288, flip ? roomAbove : below)));
    };
    place();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
      window.removeEventListener("scroll", place);
    };
  }, [showPanel, options.length]);

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

  const choose = (option: Option) => {
    if (!query) return;
    const next = insertMention(text, mentions, { start: query.start, end: query.caret }, { ...option.item, kind: option.kind });
    if (option.kind === "group") setChosenInfo((c) => ({ key: placeKey, groups: { ...(c.key === placeKey ? c.groups : {}), [option.item.id]: option.item } }));
    commit(next, next.caret);
    setQuery(null);
    inner.current?.focus();
  };

  const status = !open
    ? ""
    : unavailable === "team"
      ? "Mentions aren't available on confidential requests."
      : unavailable === "private"
        ? "Choose who can see this request to mention people or groups."
        : peopleFull && groupsFull
          ? `You can mention up to ${MENTION_LIMIT} people and ${GROUP_MENTION_LIMIT} groups.`
          : loading
            ? ""
            : options.length
              ? `${describe(members.length, "person", "people")}${groups.length ? ` and ${describe(groups.length, "group", "groups")}` : ""} found. Use the up and down arrows, then Enter to mention.`
              : "No one to mention by that name here.";

  const chosenGroups = mentions.filter((m) => m.kind === "group" && groupInfo[m.id]).filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i);
  const optionRow = (o: Option, i: number) => (
    <li
      key={`${o.kind}-${o.item.id}`}
      id={`${listId}-${i}`}
      role="option"
      aria-selected={i === activeIndex}
      // Keep focus (and the caret) in the text box while choosing by mouse or touch.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => choose(o)}
      className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2.5 py-1.5", i === activeIndex ? "bg-primary-soft text-text" : "hover:bg-surface-muted")}
    >
      {o.kind === "member" ? (
        <>
          <MemberAvatar name={o.item.name} photoUrl={o.item.photoUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{o.item.name}</span>
            {o.item.detail ? <span className="block truncate text-[0.8125rem] text-text-secondary">{o.item.detail}</span> : null}
          </span>
        </>
      ) : (
        <>
          {o.item.imageUrl ? (
            <img src={o.item.imageUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Users className="size-4" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{o.item.name}</span>
              <span className="shrink-0 rounded-full border border-border px-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-text-secondary">Group</span>
            </span>
            <span className="block truncate text-[0.8125rem] text-text-secondary">
              {o.item.notify === "notify" ? `Notifies ${o.item.reach ?? 0} ${o.item.reach === 1 ? "person" : "people"}` : "Mention without notifying"}
            </span>
          </span>
        </>
      )}
    </li>
  );

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <input type="hidden" name={name} value={value} />
      <AutoGrowTextarea
        {...rest}
        ref={setRefs}
        minRows={minRows}
        className={className}
        value={text}
        // A multi-line text box keeps its textbox role; the list is tied to it
        // with aria-controls and the highlighted option with aria-activedescendant.
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
              setActive((i) => (Math.min(i, options.length - 1) + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(options[activeIndex]);
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
      {links ? (
        <>
          {linkTools.bar}
          <div className="mt-0.5 flex flex-wrap items-center">
            <LinkButton tools={linkTools} className="-ml-1" />
          </div>
          {linkTools.dialog}
        </>
      ) : null}
      <ul
        id={listId}
        role="listbox"
        aria-label="People and groups you can mention"
        hidden={!options.length}
        style={{ maxHeight }}
        className={cn(
          "absolute inset-x-0 z-30 overflow-y-auto overscroll-contain rounded-card border border-border bg-surface p-1 shadow-(--elev-lift)",
          above ? "bottom-full mb-1" : "top-full mt-1",
        )}
      >
        {members.length ? (
          <li role="presentation">
            <p id={`${listId}-members`} className="px-2.5 pb-0.5 pt-1.5 text-[0.75rem] font-semibold uppercase tracking-wide text-text-secondary">
              Members
            </p>
            <ul role="group" aria-labelledby={`${listId}-members`}>
              {options.filter((o) => o.kind === "member").map((o, i) => optionRow(o, i))}
            </ul>
          </li>
        ) : null}
        {groups.length ? (
          <li role="presentation">
            <p id={`${listId}-groups`} className="px-2.5 pb-0.5 pt-1.5 text-[0.75rem] font-semibold uppercase tracking-wide text-text-secondary">
              Groups
            </p>
            <ul role="group" aria-labelledby={`${listId}-groups`}>
              {options.filter((o) => o.kind === "group").map((o, i) => optionRow(o, members.length + i))}
            </ul>
          </li>
        ) : null}
      </ul>
      {showPanel && !options.length && status ? (
        <p className={cn("absolute inset-x-0 z-30 rounded-card border border-border bg-surface px-3 py-2 text-meta text-text-secondary shadow-(--elev-lift)", above ? "bottom-full mb-1" : "top-full mt-1")}>
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
            <span key={`${m.kind ?? "member"}-${m.id}-${m.start}`} className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-primary-soft py-0.5 pl-2 font-semibold text-primary">
              {m.kind === "group" ? <Users className="size-3.5 shrink-0" aria-hidden="true" /> : <AtSign className="size-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{m.name}</span>
              {m.kind === "group" ? <span className="sr-only"> (group)</span> : null}
              <button
                type="button"
                onClick={() => {
                  commit(removeMention(text, mentions, m), m.start);
                  inner.current?.focus();
                }}
                className="ml-0.5 flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Remove the mention of {m.name}</span>
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {chosenGroups.length ? (
        <ul className="mt-1.5 space-y-1 text-meta text-text-secondary">
          {chosenGroups.map((m) => (
            <li key={`notice-${m.id}`} className="flex items-start gap-1.5">
              <Users className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{groupNotice(groupInfo[m.id])}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function describe(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function firstDifference(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
