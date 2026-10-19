"use client";

import { Flag, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markReadAction, sendMessageAction } from "@/app/(member)/messages/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { LIMITS } from "@/lib/community/format";
import type { ConversationPage, Message } from "@/lib/community/types";
import { useCommunityRealtime } from "./realtime-provider";
import { ReportDialog } from "./report-dialog";

type Pending = { key: string; body: string; state: "sending" | "failed"; error?: string };

function mergeMessages(a: Message[], b: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => (x.created_at === y.created_at ? x.id.localeCompare(y.id) : x.created_at < y.created_at ? -1 : 1));
}

function timeLabel(iso: string, tz: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * A one-to-one conversation.
 *
 * - The server page provides the first (newest) page; the database is the
 *   source of truth. On every Realtime signal, reconnect, or focus, the
 *   newest page is refetched and merged by message id, so duplicates and
 *   missed signals don't matter.
 * - Sending is optimistic with a per-message idempotency key: if the send
 *   fails, the text stays as a "not sent" item with Retry, and a retry can
 *   never create a duplicate.
 * - Screen readers hear a short "New message from …" status, never the whole
 *   conversation again. Focus stays in the message box after sending.
 * - If access ends (session expired, suspension, the conversation is gone),
 *   the page reloads so the server decides what to show.
 * - Drafts live only in memory on this page (never in browser storage).
 */
export function Conversation({ initial, timezone }: { initial: ConversationPage; timezone: string }) {
  const { version, refresh } = useCommunityRealtime();
  const [messages, setMessages] = useState<Message[]>(() => mergeMessages([], initial.messages));
  const [hasMore, setHasMore] = useState(initial.has_more);
  const [canSend, setCanSend] = useState(initial.can_send);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [announce, setAnnounce] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const known = useRef(new Set(initial.messages.map((m) => m.id)));
  const conversationId = initial.id;

  const fetchPage = useCallback(
    async (before?: Message) => {
      const qs = before ? `?before_at=${encodeURIComponent(before.created_at)}&before_id=${before.id}` : "";
      const res = await fetch(`/api/community/conversations/${conversationId}${qs}`, { cache: "no-store", credentials: "same-origin" });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        window.location.reload();
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as ConversationPage;
    },
    [conversationId],
  );

  const markRead = useCallback(() => {
    if (document.visibilityState === "visible") void markReadAction(conversationId).then(() => refresh());
  }, [conversationId, refresh]);

  // Catch up on every signal or reconnect.
  const firstVersion = useRef(version);
  useEffect(() => {
    if (version === firstVersion.current) return;
    let cancelled = false;
    void fetchPage().then((page) => {
      if (!page || cancelled) return;
      const incoming = page.messages.filter((m) => !m.mine && !known.current.has(m.id));
      for (const m of page.messages) known.current.add(m.id);
      setMessages((prev) => mergeMessages(prev, page.messages));
      setCanSend(page.can_send);
      if (incoming.length) {
        setAnnounce(incoming.length === 1 ? `New message from ${initial.other_name}` : `${incoming.length} new messages from ${initial.other_name}`);
        markRead();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [version, fetchPage, initial.other_name, markRead]);

  useEffect(() => {
    markRead();
    endRef.current?.scrollIntoView({ block: "end" });
  }, [markRead]);

  async function deliver(key: string, body: string) {
    setPending((p) => p.map((x) => (x.key === key ? { ...x, state: "sending", error: undefined } : x)));
    let result: Awaited<ReturnType<typeof sendMessageAction>>;
    try {
      result = await sendMessageAction({ conversationId, body, clientKey: key });
    } catch {
      result = { ok: false, message: "You seem to be offline. Your message wasn't sent." };
    }
    if (result.ok) {
      known.current.add(result.id);
      setMessages((prev) => mergeMessages(prev, [{ id: result.id, body: body.trim(), mine: true, created_at: result.created_at }]));
      setPending((p) => p.filter((x) => x.key !== key));
      setAnnounce("Message sent");
    } else {
      setPending((p) => p.map((x) => (x.key === key ? { ...x, state: "failed", error: result.message } : x)));
      setAnnounce(`Not sent: ${result.message}`);
    }
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const key = crypto.randomUUID();
    setPending((p) => [...p, { key, body, state: "sending" }]);
    setDraft("");
    inputRef.current?.focus();
    void deliver(key, body);
  }

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    const page = await fetchPage(oldest);
    setLoadingOlder(false);
    if (!page) return;
    for (const m of page.messages) known.current.add(m.id);
    setMessages((prev) => mergeMessages(page.messages, prev));
    setHasMore(page.has_more);
    setAnnounce(page.messages.length ? `Loaded ${page.messages.length} earlier messages` : "No earlier messages");
  }

  const days = useMemo(() => {
    const groups: Array<{ day: string; items: Message[] }> = [];
    for (const m of messages) {
      const day = new Date(m.created_at).toLocaleDateString("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" });
      const last = groups[groups.length - 1];
      if (last?.day === day) last.items.push(m);
      else groups.push({ day, items: [m] });
    }
    return groups;
  }, [messages, timezone]);

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hasMore ? (
          <Button size="sm" variant="secondary" onClick={loadOlder} loading={loadingOlder} loadingText="Loading…">
            Show earlier messages
          </Button>
        ) : (
          <span className="text-sm text-text-secondary">{messages.length ? "Start of your conversation" : ""}</span>
        )}
        {selecting ? (
          <div className="flex flex-wrap items-center gap-2">
            <ReportDialog type="message" ids={selected} what={selected.length === 1 ? "1 selected message" : `${selected.length} selected messages`} label="Report" />
            <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden="true" />} onClick={() => (setSelecting(false), setSelected([]))}>
              Cancel
            </Button>
          </div>
        ) : messages.some((m) => !m.mine) ? (
          <Button size="sm" variant="ghost" icon={<Flag className="size-4" aria-hidden="true" />} onClick={() => setSelecting(true)}>
            Report messages
          </Button>
        ) : null}
      </div>
      {selecting ? <p className="text-[0.95rem] text-text-secondary">Choose the messages to report (up to 20). Moderators see only those messages.</p> : null}

      {messages.length === 0 && pending.length === 0 ? (
        <p className="rounded-card bg-surface px-5 py-6 text-center text-text-secondary">No messages yet. Say hello.</p>
      ) : (
        <div className="space-y-5">
          {days.map((d) => (
            <section key={d.day} aria-label={d.day}>
              <h2 className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-text-secondary">{d.day}</h2>
              <ol className="space-y-2">
                {d.items.map((m) => (
                  <li key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                    <div className={cn("flex max-w-[85%] items-start gap-2", m.mine && "flex-row-reverse")}>
                      {selecting ? (
                        <input
                          type="checkbox"
                          className="mt-3 size-5 accent-primary"
                          aria-label={`Select message from ${m.mine ? "you" : initial.other_name} at ${timeLabel(m.created_at, timezone)}`}
                          checked={selected.includes(m.id)}
                          disabled={!selected.includes(m.id) && selected.length >= 20}
                          onChange={(e) => setSelected((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))}
                        />
                      ) : null}
                      <div className={cn("rounded-2xl px-4 py-2.5", m.mine ? "bg-cta text-on-cta" : "bg-surface text-text")}>
                        <p className="sr-only">{m.mine ? "You:" : `${initial.other_name}:`}</p>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={cn("mt-1 text-xs", m.mine ? "text-on-cta/70" : "text-text-secondary")}>
                          <time dateTime={m.created_at}>{timeLabel(m.created_at, timezone)}</time>
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {pending.length ? (
            <ol className="space-y-2" aria-label="Messages being sent">
              {pending.map((p) => (
                <li key={p.key} className="flex justify-end">
                  <div className={cn("max-w-[85%] rounded-2xl border px-4 py-2.5", p.state === "failed" ? "border-danger bg-danger-soft" : "border-border bg-surface-muted")}>
                    <p className="whitespace-pre-wrap break-words">{p.body}</p>
                    {p.state === "sending" ? (
                      <p className="mt-1 text-xs text-text-secondary">Sending…</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <p className="text-sm font-semibold text-danger">Not sent. {p.error}</p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => void deliver(p.key, p.body)}>
                            Retry
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setDraft((d) => (d ? `${d}\n${p.body}` : p.body));
                              setPending((x) => x.filter((y) => y.key !== p.key));
                              inputRef.current?.focus();
                            }}
                          >
                            Edit
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )}
      <div ref={endRef} />

      {canSend ? (
        <form onSubmit={onSubmit} className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 rounded-card border border-border bg-surface p-3 lg:bottom-4">
          <label htmlFor="message-input" className="sr-only">
            Message {initial.other_name}
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="message-input"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(e);
              }}
              rows={2}
              maxLength={LIMITS.message}
              placeholder={`Message ${initial.other_name}`}
              aria-describedby="message-hint"
              className="min-h-12 flex-1 resize-y rounded-control border border-border-strong bg-background px-4 py-2.5"
            />
            <Button type="submit" disabled={!draft.trim()} icon={<Send className="size-4" aria-hidden="true" />}>
              Send
            </Button>
          </div>
          <p id="message-hint" className="mt-1 text-xs text-text-secondary">
            Text only. Visible only to you and {initial.other_name} (access-controlled, not end-to-end encrypted). Ctrl/⌘ + Enter sends.
          </p>
        </form>
      ) : (
        <p className="rounded-card border border-border bg-surface px-5 py-4 text-text-secondary">
          You can&apos;t send messages in this conversation right now. You can still read your history.
        </p>
      )}
    </div>
  );
}
