import { CheckCircle2, EyeOff, Globe, HandHeart, Lock, MessageCircle, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { relativeTime } from "@/lib/community/format";
import { AUDIENCE_LABEL, STATUS_LABEL } from "@/lib/prayer/format";
import type { Audience, PrayerCard } from "@/lib/prayer/types";

const ICON: Record<Audience, ReactNode> = {
  church: <Globe className="size-3.5" aria-hidden="true" />,
  group: <Users className="size-3.5" aria-hidden="true" />,
  team: <ShieldCheck className="size-3.5" aria-hidden="true" />,
  private: <Lock className="size-3.5" aria-hidden="true" />,
};

export function AudienceTag({ audience, groupName }: { audience: Audience; groupName?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-primary">
      {ICON[audience]} {audience === "group" ? (groupName ?? "Group") : AUDIENCE_LABEL[audience]}
    </span>
  );
}

/** Container for a list of requests: separate cards with a small gap. */
export const prayerListClass = "space-y-3";

/** One request in a list. Shows only what the reader may see; no avatars or profile links. */
export function PrayerRow({ card }: { card: PrayerCard }) {
  return (
    <Link
      href={`/prayer/${card.id}`}
      className="block rounded-card border border-border bg-surface px-4 py-3.5 shadow-(--elev-card) transition-colors hover:border-border-strong/60 hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-5 sm:py-4"
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-secondary">
        <span>
          <span className="font-semibold text-text">{card.mine ? `You${card.anonymous ? " (shown as Anonymous)" : ""}` : card.author}</span> ·{" "}
          <time dateTime={card.last_activity_at}>{relativeTime(card.last_activity_at)}</time>
        </span>
        {card.status !== "open" ? (
          <span className="inline-flex items-center gap-1 font-semibold">
            {card.status === "answered" ? <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" /> : null}
            {STATUS_LABEL[card.status]}
          </span>
        ) : null}
        {card.hidden ? (
          <span className="inline-flex items-center gap-1 font-semibold text-danger">
            <EyeOff className="size-3.5" aria-hidden="true" /> Hidden by a moderator
          </span>
        ) : null}
      </p>
      <p className="mt-1 font-display text-[1.1875rem] font-semibold leading-snug text-text sm:text-[1.3125rem]">{card.title}</p>
      <p className="mt-1 line-clamp-2 text-meta text-text-secondary sm:text-base">{card.excerpt}</p>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-meta text-text-secondary">
        <span className="font-semibold">
          <AudienceTag audience={card.audience} groupName={card.group?.name} />
        </span>
        {card.audience !== "private" ? (
          <>
            <span className="inline-flex items-center gap-1">
              <HandHeart className={card.praying ? "size-4 text-primary" : "size-4"} aria-hidden="true" />
              {card.prayer_count} praying
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-4" aria-hidden="true" />
              {card.comment_count}
              <span className="sr-only"> comments</span>
            </span>
          </>
        ) : null}
      </p>
    </Link>
  );
}
