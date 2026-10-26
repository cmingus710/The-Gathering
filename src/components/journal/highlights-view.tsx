"use client";

import { AlertCircle, BookOpen, ListPlus, Minus, NotebookPen, RotateCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { applyHighlightAction } from "@/app/(app)/(member)/bible/actions";
import { highlightPassagesAction, highlightTextsAction } from "@/app/(app)/(member)/journal/actions";
import { trackFums } from "@/components/bible/fums";
import { HighlightColorButtons } from "@/components/bible/highlight-colors";
import { Attribution, ScriptureText } from "@/components/bible/scripture";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/bible/format";
import type { HighlightPage, HighlightPassage, PassageText } from "@/lib/bible/highlight-passages";
import { colorLabel, memoryAddHref, readerHref, textKey, type ApplyResult, type PassageRef } from "@/lib/bible/highlights";

type Filters = { query: string; color: string; translationId: string; sort: "recent" | "bible" };
type ItemSave = { status: "saving" } | { status: "failed"; message: string; retry: () => void } | { status: "conflict"; message: string };

const refOf = (p: HighlightPassage): PassageRef => ({ translation_id: p.translation.id, book: p.book, chapter: p.chapter, start_verse: p.start_verse, end_verse: p.end_verse });
const fieldClass = "min-h-12 rounded-control border border-border-strong bg-surface px-3 text-base text-text";

/**
 * My Journal · Scripture Highlights. A synchronized view of the member's
 * highlight records (not journal entries): what's highlighted in the reader
 * shows here, and changes here show in the reader. Passages are adjacent
 * verses of one color; each shows its reference, translation, color, and
 * its text as available now (licensed text is fetched when shown, kept only
 * in this page's memory, with its attribution and usage reporting).
 *
 * Filters are sent by POST (like journal search). After a change the list
 * is re-read from the server; text already shown is reused, so recoloring
 * a passage neither refetches it nor reports another view.
 */
export function HighlightsView({ initial, initialTexts }: { initial: HighlightPage; initialTexts: Record<string, PassageText> }) {
  const [page, setPage] = useState(initial);
  const [texts, setTexts] = useState(initialTexts);
  const [filters, setFilters] = useState<Filters>({ query: "", color: "", translationId: "", sort: "recent" });
  const [applied, setApplied] = useState<Filters>(filters);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [saves, setSaves] = useState<Record<string, ItemSave>>({});
  const [pending, start] = useTransition();
  const reported = useRef(new Set<string>());
  const textsRef = useRef(texts);
  useEffect(() => {
    textsRef.current = texts;
  }, [texts]);

  // API.Bible usage reporting: once per passage shown in this view.
  useEffect(() => {
    for (const t of Object.values(texts)) {
      if (t.status === "ok" && t.fumsId && !reported.current.has(t.fumsId)) {
        reported.current.add(t.fumsId);
        trackFums(t.fumsId);
      }
    }
  }, [texts]);

  const fetchTexts = async (items: HighlightPassage[], force = false) => {
    const missing = items.filter((i) => i.translation.available && (force || !textsRef.current[textKey(refOf(i))])).map(refOf);
    if (!missing.length) return;
    try {
      const got = await highlightTextsAction(missing);
      setTexts((t) => ({ ...t, ...got }));
    } catch {
      setTexts((t) => ({ ...t, ...Object.fromEntries(missing.map((r) => [textKey(r), { status: "unavailable", message: "The passage couldn't be loaded right now." } as PassageText])) }));
    }
  };

  const load = (f: Filters, offset: number, limit = 20, keep?: HighlightPassage[]) =>
    start(async () => {
      let r: Awaited<ReturnType<typeof highlightPassagesAction>>;
      try {
        r = await highlightPassagesAction({ ...f, offset, limit });
      } catch {
        r = { ok: false, message: "Your highlights couldn't be loaded right now." };
      }
      if (!r.ok) return setError(r.message);
      setError(null);
      setApplied(f);
      const items = keep ? [...keep, ...r.page.items] : r.page.items;
      setPage({ ...r.page, items });
      await fetchTexts(r.page.items);
    });

  /** Re-reads what's shown after a change, keeping the same filters and count. */
  const reload = () => load(applied, 0, Math.min(50, Math.max(20, page.items.length)));

  const change = async (item: HighlightPassage, color: HighlightColor | null) => {
    const req = {
      translationId: item.translation.id,
      book: item.book,
      chapter: item.chapter,
      verses: item.verses.map((v) => v.verse),
      color,
      expected: Object.fromEntries(item.verses.map((v) => [String(v.verse), v.revision])),
    };
    const what = color ? `${colorLabel(color)} highlight on ${item.label}` : `Removing the highlight from ${item.label}`;
    const run = async () => {
      setSaves((s) => ({ ...s, [item.key]: { status: "saving" } }));
      let r: ApplyResult;
      try {
        r = await applyHighlightAction(req);
      } catch {
        r = { ok: false, message: "The connection was interrupted.", retryable: true };
      }
      if (!r.ok) {
        setSaves((s) => ({ ...s, [item.key]: { status: "failed", message: `${what} wasn't saved. ${r.message}`, retry: () => void run() } }));
        return;
      }
      if (r.status === "conflict") {
        setSaves((s) => ({ ...s, [item.key]: { status: "conflict", message: "This passage was changed elsewhere. Its current highlights are shown; nothing was changed." } }));
      } else {
        setSaves((s) => {
          const next = { ...s };
          delete next[item.key];
          return next;
        });
        setStatus(`${what} saved.`);
      }
      reload();
    };
    await run();
  };

  const translationName = useMemo(() => new Map(page.translations.map((t) => [t.id, `${t.code} · ${t.name}`])), [page.translations]);
  const filtered = Boolean(applied.query || applied.color || applied.translationId);

  return (
    <div>
      <form
        role="search"
        aria-label="Scripture Highlights"
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          load(filters, 0);
        }}
      >
        <div className="flex flex-col gap-1 text-meta text-text-secondary sm:col-span-2 lg:col-span-4">
          <label htmlFor="hl-filter-reference">Reference</label>
          <span className="flex flex-wrap gap-2">
            <input
              id="hl-filter-reference"
              type="search"
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder="For example John 3 or Psalm 23"
              className={`${fieldClass} min-w-[min(100%,8rem)] flex-1`}
            />
            <Button type="submit" variant="secondary" loading={pending} icon={<Search className="size-4" aria-hidden="true" />}>
              Search
            </Button>
          </span>
        </div>
        <div className="flex flex-col gap-1 text-meta text-text-secondary">
          <label htmlFor="hl-filter-color">Color</label>
          <select id="hl-filter-color" className={fieldClass} value={filters.color} onChange={(e) => { const f = { ...filters, color: e.target.value }; setFilters(f); load(f, 0); }}>
            <option value="">All colors</option>
            {HIGHLIGHT_COLORS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 text-meta text-text-secondary">
          <label htmlFor="hl-filter-translation">Translation</label>
          <select id="hl-filter-translation" className={fieldClass} value={filters.translationId} onChange={(e) => { const f = { ...filters, translationId: e.target.value }; setFilters(f); load(f, 0); }}>
            <option value="">All translations</option>
            {page.translations.map((t) => (
              <option key={t.id} value={t.id}>
                {translationName.get(t.id)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 text-meta text-text-secondary">
          <label htmlFor="hl-filter-order">Order</label>
          <select id="hl-filter-order" className={fieldClass} value={filters.sort} onChange={(e) => { const f = { ...filters, sort: e.target.value as Filters["sort"] }; setFilters(f); load(f, 0); }}>
            <option value="recent">Most recently highlighted</option>
            <option value="bible">Bible order</option>
          </select>
        </div>
      </form>

      <p role="status" className="mb-2 text-meta text-text-secondary">
        {error ?? (pending ? "Loading…" : status || (filtered ? `${page.total} ${page.total === 1 ? "passage matches" : "passages match"}.` : ""))}
      </p>

      {page.items.length ? (
        <ul className="space-y-4">
          {page.items.map((item) => (
            <HighlightItem key={item.key} item={item} text={texts[textKey(refOf(item))]} save={saves[item.key]} onChange={change} onRetryText={() => fetchTexts([item], true)} />
          ))}
        </ul>
      ) : (
        <EmptyState glyph="journal" title={filtered ? "No highlights match" : "No highlights yet"}>
          {filtered ? "Try another reference, color, or translation." : "Highlight verses in the Bible reader and they'll appear here automatically."}
        </EmptyState>
      )}
      {page.items.length < page.total ? (
        <Button variant="secondary" size="sm" className="mt-4" loading={pending} onClick={() => load(applied, page.items.length, 20, page.items)}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}

function HighlightItem({
  item,
  text,
  save,
  onChange,
  onRetryText,
}: {
  item: HighlightPassage;
  text: PassageText | undefined;
  save: ItemSave | undefined;
  onChange: (item: HighlightPassage, color: HighlightColor | null) => void;
  onRetryText: () => void;
}) {
  const marks = useMemo(() => new Map(item.verses.map((v) => [v.verse, item.color as string])), [item]);
  const headingId = `hl-${item.key.replace(/[^A-Za-z0-9-]/g, "-")}`;
  const busy = save?.status === "saving";
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(item.updated_at));
  return (
    <li aria-labelledby={headingId} className="rounded-card border border-border bg-surface p-4 shadow-(--elev-card)">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="font-display text-[1.25rem] font-semibold">
          {item.label} <span className="text-text-secondary">({item.translation.code})</span>
        </h3>
        <p className="flex items-center gap-2 text-meta text-text-secondary">
          <span aria-hidden="true" className="size-3.5 rounded-full border border-border-strong" style={{ background: `var(--hl-${item.color})` }} />
          {colorLabel(item.color)} · {date}
        </p>
      </div>

      {!item.translation.available ? (
        <p className="text-meta text-text-secondary">{item.translation.name} isn&apos;t available any more, so its text can&apos;t be shown. Your highlight is kept; you can remove it.</p>
      ) : !text ? (
        <p className="flex items-center gap-2 text-meta text-text-secondary">
          <Spinner /> Loading the passage…
        </p>
      ) : text.status === "unavailable" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-tile border border-border bg-surface-muted p-3 text-meta">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{text.message}</span>
          <Button size="sm" variant="secondary" onClick={onRetryText} icon={<RotateCw className="size-4" aria-hidden="true" />}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <ScriptureText verses={text.verses} translation={text.translation} highlights={marks} label={`${item.label}, ${item.translation.code}`} />
          <Attribution translation={text.translation} extra={text.copyright} />
        </>
      )}

      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {item.translation.available ? (
          <HighlightColorButtons pressed={(c) => c === item.color} onPick={(c) => c !== item.color && onChange(item, c)} disabled={busy} label={`Highlight color for ${item.label}`} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {item.translation.available ? (
            <>
              <ButtonLink href={readerHref({ code: item.translation.code, book: item.book, chapter: item.chapter, start: item.start_verse })} size="sm" variant="secondary" icon={<BookOpen className="size-4" aria-hidden="true" />}>
                Open in Bible
              </ButtonLink>
              <ButtonLink
                href={memoryAddHref({ translationId: item.translation.id, book: item.book, chapter: item.chapter, start: item.start_verse, end: item.end_verse })}
                size="sm"
                variant="secondary"
                icon={<ListPlus className="size-4" aria-hidden="true" />}
              >
                Add to Memory Verses
              </ButtonLink>
              <ButtonLink
                href={`/journal/new?${new URLSearchParams({ t: item.translation.id, b: item.book, c: String(item.chapter), sv: String(item.start_verse), ev: String(item.end_verse) })}`}
                size="sm"
                variant="secondary"
                icon={<NotebookPen className="size-4" aria-hidden="true" />}
              >
                Write a reflection
              </ButtonLink>
            </>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange(item, null)} icon={<Minus className="size-4" aria-hidden="true" />}>
            Remove highlight
          </Button>
        </div>
        {save?.status === "saving" ? (
          <p className="flex items-center gap-2 text-meta text-text-secondary">
            <Spinner /> Saving…
          </p>
        ) : save?.status === "failed" ? (
          <div className="flex flex-wrap items-center gap-2 text-meta text-danger">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{save.message}</span>
            <Button size="sm" variant="secondary" onClick={save.retry} icon={<RotateCw className="size-4" aria-hidden="true" />}>
              Retry
            </Button>
          </div>
        ) : save?.status === "conflict" ? (
          <p className="text-meta">{save.message}</p>
        ) : null}
      </div>
    </li>
  );
}
