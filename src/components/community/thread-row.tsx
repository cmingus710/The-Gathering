import { EyeOff, Lock, MessageSquare, Pin } from "lucide-react";
import Link from "next/link";
import { relativeTime } from "@/lib/community/format";
import type { ThreadCard } from "@/lib/community/types";

/** One discussion in a list: title, place, author, replies, activity. Badges carry words, not just icons. */
export function ThreadRow({ thread, showPlace = false }: { thread: ThreadCard; showPlace?: boolean }) {
  const deleted = thread.status === "deleted";
  const title = deleted ? "Deleted discussion" : (thread.title ?? "Discussion");
  const place = thread.group ? `Group: ${thread.group.name}` : thread.category?.name;
  return (
    <Link
      href={`/community/t/${thread.id}`}
      className="block rounded-card bg-surface px-5 py-4 transition-colors hover:bg-surface-muted"
    >
      <span className="flex flex-wrap items-center gap-2">
        {thread.pinned ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-primary">
            <Pin className="size-3.5" aria-hidden="true" /> Pinned
          </span>
        ) : null}
        {thread.locked ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-text-secondary">
            <Lock className="size-3.5" aria-hidden="true" /> Locked
          </span>
        ) : null}
        {thread.status === "hidden" ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-danger">
            <EyeOff className="size-3.5" aria-hidden="true" /> Hidden
          </span>
        ) : null}
        {showPlace && place ? <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">{place}</span> : null}
      </span>
      <span className={`mt-1 block text-[1.05rem] font-semibold ${deleted ? "italic text-text-secondary" : "text-text"}`}>{title}</span>
      {thread.excerpt ? <span className="mt-0.5 line-clamp-2 block text-[0.95rem] text-text-secondary">{thread.excerpt}</span> : null}
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
        {thread.author ? <span>{thread.author}</span> : null}
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3.5" aria-hidden="true" />
          {thread.reply_count === 1 ? "1 reply" : `${thread.reply_count} replies`}
        </span>
        <span>
          Active <time dateTime={thread.last_activity_at}>{relativeTime(thread.last_activity_at)}</time>
        </span>
      </span>
    </Link>
  );
}
