import { CalendarDays, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { campaignDates, type PublicCampaign } from "@/lib/giving/campaigns";
import { CampaignMeter } from "./campaign-meter";

/** A campaign in the /give list: title, dates, meter, and a link to give. */
export function CampaignCard({ campaign: c, imageUrl }: { campaign: PublicCampaign; imageUrl?: string | null }) {
  const dates = campaignDates(c.starts_on, c.ends_on);
  return (
    <li className="overflow-hidden rounded-card border border-border bg-surface shadow-(--elev-card)">
      <Link href={`/give/campaigns/${c.id}`} className="group block focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; keep it out of the image cache
          <img src={imageUrl} alt="" className="aspect-[16/7] w-full object-cover" />
        ) : null}
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-lg font-semibold leading-snug text-text group-hover:text-primary">{c.title}</h3>
            {c.status === "closed" ? <Badge tone="neutral">Closed</Badge> : !c.accepting_gifts ? <Badge tone="neutral">Not open yet</Badge> : null}
          </div>
          {dates ? (
            <p className="flex items-center gap-1.5 text-meta text-text-secondary">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              {dates} · {c.fund_name}
            </p>
          ) : (
            <p className="text-meta text-text-secondary">{c.fund_name}</p>
          )}
          <CampaignMeter raisedCents={c.raised_cents} goalCents={c.goal_cents} percent={c.percent} goalReached={c.goal_reached} closed={!c.accepting_gifts} size="sm" />
          <p className="inline-flex items-center gap-0.5 font-semibold text-primary">
            {c.accepting_gifts ? "Give to this campaign" : "See the campaign"}
            <ChevronRight className="size-4" aria-hidden="true" />
          </p>
        </div>
      </Link>
    </li>
  );
}
