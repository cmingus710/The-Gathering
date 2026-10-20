import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Attribution, ScriptureText } from "@/components/bible/scripture";
import { CommunityText } from "@/components/community/community-text";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { formatYmd } from "@/lib/bible/dates";
import { kindLabel, scheduleLabel } from "@/lib/bible/format";
import { resolveText } from "@/lib/bible/source";
import type { PassagePayload } from "@/lib/bible/types";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import type { AdminDay } from "../../../day-form";

export const metadata: Metadata = { title: "Plan preview" };

type Plan = { id: string; title: string; description: string; status: string; mode: "calendar" | "personal"; translation_id: string; translation: { code: string; status: string }; day_list: AdminDay[]; first_date: string | null; last_date: string | null; last_day_number: number | null; reading_days: number };

/** What members will see, before publishing. Choose a day to read its passages. */
export default async function PlanPreviewPage({ params, searchParams }: PageProps<"/admin/bible/plans/[id]/preview">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireAnyCapability([CAPABILITIES.readingEdit, CAPABILITIES.readingPublish], `/admin/bible/plans/${id}`);
  const sp = await searchParams;
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_admin_plan", { p_id: id });
  if (error?.code === "P0002") notFound();
  if (error || !data) return <Alert tone="error" title="This plan couldn't be loaded right now." />;
  const plan = data as Plan;
  const days = plan.day_list.filter((d) => !d.retired_at);
  const chosen = days.find((d) => d.id === sp.day) ?? days[0];

  let texts: Array<{ label: string; payload: PassagePayload | null; text: Awaited<ReturnType<typeof resolveText>> | null }> = [];
  if (chosen && plan.translation.status === "active") {
    texts = await Promise.all(
      chosen.passages.map(async (p) => {
        const r = await supabase.rpc("bible_passage", { p_translation: plan.translation_id, p_book: p.book, p_sc: p.sc, p_sv: p.sv, p_ec: p.ec, p_ev: p.ev });
        if (r.error || !r.data) return { label: p.label, payload: null, text: null };
        const payload = r.data as PassagePayload;
        return { label: p.label, payload, text: await resolveText(payload.translation, payload.verses, payload.provider, { book: p.book, sc: p.sc, sv: p.sv, ec: p.ec, ev: p.ev }) };
      }),
    );
  }

  return (
    <>
      <p className="mb-4">
        <Link href={`/admin/bible/plans/${plan.id}`} className="font-semibold text-primary hover:underline">
          Back to the plan
        </Link>
      </p>
      <PageHeader title={plan.title} eyebrow={<Badge tone="warning">Preview</Badge>} description={`${scheduleLabel(plan)} · ${plan.reading_days} readings`} />
      {plan.description ? <p className="mb-6 max-w-[65ch] whitespace-pre-line text-text-secondary">{plan.description}</p> : null}
      {plan.translation.status !== "active" ? <Alert tone="warning" title="The plan's translation isn't active yet, so passage text can't be shown." className="mb-6" /> : null}
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav aria-label="Days" className="max-h-[70vh] overflow-auto rounded-card border border-border">
          <ol className="divide-y divide-border">
            {days.map((d) => (
              <li key={d.id}>
                <Link href={`?day=${d.id}`} aria-current={d.id === chosen?.id ? "page" : undefined} className="block px-3 py-2 text-meta hover:bg-surface-muted/60 aria-[current=page]:bg-primary-soft">
                  <span className="block text-text-secondary">{d.day_date ? formatYmd(d.day_date, "short") : `Day ${d.day_number}`}</span>
                  <span className="block truncate font-semibold">{d.kind === "rest" ? "Rest day" : d.passages.map((p) => p.label).join("; ") || kindLabel(d.kind)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        {chosen ? (
          <article>
            <p className="text-meta font-semibold text-text-secondary">{chosen.day_date ? formatYmd(chosen.day_date, "full") : `Day ${chosen.day_number}`}</p>
            <h2 className="mb-4 font-display text-xl font-semibold">{chosen.heading ?? (chosen.kind === "rest" ? "Rest day" : chosen.passages.map((p) => p.label).join("; "))}</h2>
            {chosen.notes ? <CommunityText source={chosen.notes} className="mb-4 text-text-secondary" /> : null}
            {texts.map((t, i) => (
              <section key={i} className="mb-6">
                <SectionHeading as="h3">{t.label}</SectionHeading>
                {t.payload && t.text?.status === "ok" ? (
                  <ScriptureText verses={t.text.verses} translation={t.payload.translation} label={t.label} />
                ) : (
                  <Alert tone="warning" title="This passage's text isn't available." />
                )}
              </section>
            ))}
            {texts[0]?.payload ? <Attribution translation={texts[0].payload.translation} /> : null}
            {chosen.questions.length ? (
              <section className="mt-6">
                <SectionHeading as="h3">Reflect</SectionHeading>
                <ul className="list-disc space-y-1 pl-5">
                  {chosen.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>
        ) : (
          <p className="text-text-secondary">No days yet.</p>
        )}
      </div>
    </>
  );
}
