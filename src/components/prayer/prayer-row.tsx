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

/** One request in a list. Shows only what the reader may see; no avatars or profile links. */
export function PrayerRow({ card }: { card: PrayerCard }) {
  return (
    <Link href={`/prayer/${card.id}`} className="block px-5 py-4 transition-colors hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-primary">
      <p className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta font-semibold">
        <AudienceTag audience={card.audience} groupName={card.group?.name} />
        {card.status !== "open" ? (
          <span className="inline-flex items-center gap-1 text-text-secondary">
            {card.status === "answered" ? <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" /> : null}
            {STATUS_LABEL[card.status]}
          </span>
        ) : null}
        {card.hidden ? (
          <span className="inline-flex items-center gap-1 text-danger">
            <EyeOff className="size-3.5" aria-hidden="true" /> Hidden by a moderator
          </span>
        ) : null}
      </p>
      <p className="font-semibold leading-snug text-text">{card.title}</p>
      <p className="mt-0.5 line-clamp-2 text-meta text-text-secondary">{card.excerpt}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-secondary">
        <span>
          {card.mine ? `You${card.anonymous ? " (shown as Anonymous)" : ""}` : card.author} · <time dateTime={card.last_activity_at}>{relativeTime(card.last_activity_at)}</time>
        </span>
        {card.audience !== "private" ? (
          <>
            <span className="inline-flex items-center gap-1">
              <HandHeart className={card.praying ? "size-3.5 text-primary" : "size-3.5"} aria-hidden="true" />
              {card.prayer_count} praying
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3.5" aria-hidden="true" />
              {card.comment_count}
              <span className="sr-only"> comments</span>
            </span>
          </>
        ) : null}
      </p>
    </Link>
  );
}
