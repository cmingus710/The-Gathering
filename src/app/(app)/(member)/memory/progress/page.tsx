import { Award, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import { MemoryNav } from "@/components/memory/nav";
import { Alert } from "@/components/ui/alert";
import { SectionHeading } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { requireLearner } from "@/lib/auth/viewer";
import { ACTIVITIES, STAGES, formatDay } from "@/lib/memory/format";
import type { Progress, Stage } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Memory progress" };

function lastDays(today: string, n: number): string[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export default async function ProgressPage() {
  await requireLearner("/memory/progress");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_progress");
  const p = data as Progress | null;
  if (error || !p) {
    return (
      <>
        <SectionHeader section="memory" size="compact" title="Progress and badges" />
        <MemoryNav current="progress" />
        <Alert tone="error" title="Your progress couldn't be loaded right now." />
      </>
    );
  }
  const practiced = new Set(p.days_28);
  const days = lastDays(p.today, 28);
  const stages = (Object.keys(STAGES) as Stage[]).map((s) => ({ s, n: p.stages?.[s] ?? 0 }));
  return (
    <>
      <SectionHeader section="memory" size="compact" title="Progress and badges" description="Private to you. Nobody else (not group leaders, administrators, or your household) can see it." />
      <MemoryNav current="progress" />
      <div className="space-y-8">
        <section aria-labelledby="summary">
          <SectionHeading id="summary">Summary</SectionHeading>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Verses practiced", p.verses_practiced],
              ["Review-ready verses", p.review_ready],
              ["Practice activities", p.sessions],
              ["In the last 7 days", p.sessions_7],
            ].map(([k, v]) => (
              <div key={k} className="rounded-card border border-border bg-surface p-4">
                <dt className="text-meta text-text-secondary">{k}</dt>
                <dd className="text-[1.75rem] font-semibold leading-tight">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="consistency">
          <SectionHeading id="consistency" description={`You practiced on ${practiced.size} of the last 28 days. Every day you come back counts; there's no streak to lose.`}>
            Consistency
          </SectionHeading>
          <ol className="grid max-w-md grid-cols-7 gap-1.5" aria-label="The last 28 days">
            {days.map((d) => (
              <li key={d} className="flex aspect-square items-center justify-center rounded-md border border-border text-[0.6875rem]" data-practiced={practiced.has(d) ? "true" : undefined}>
                <span className={practiced.has(d) ? "flex size-full items-center justify-center rounded-md bg-primary-soft font-semibold text-text" : "text-text-secondary"}>
                  <span aria-hidden="true">{practiced.has(d) ? "✓" : Number(d.slice(8))}</span>
                  <span className="sr-only">
                    {formatDay(d)}: {practiced.has(d) ? "practiced" : "no practice"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="stages">
          <SectionHeading id="stages">Where your verses are</SectionHeading>
          <ul className="grid gap-2 sm:grid-cols-2">
            {stages.map(({ s, n }) => (
              <li key={s} className="rounded-tile border border-border bg-surface p-3">
                <p className="font-semibold">
                  {STAGES[s].label}: {n}
                </p>
                <p className="text-meta text-text-secondary">{STAGES[s].description}</p>
              </li>
            ))}
          </ul>
        </section>

        {p.collections.length ? (
          <section aria-labelledby="collections">
            <SectionHeading id="collections">Collections</SectionHeading>
            <ul className="space-y-2">
              {p.collections.map((c) => (
                <li key={c.id} className="rounded-tile border border-border bg-surface p-3">
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-meta text-text-secondary">
                    {c.practiced} of {c.items} verses practiced · {c.review_ready} review-ready
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                    <div className="h-full bg-primary" style={{ width: `${Math.round((100 * c.practiced) / Math.max(1, c.items))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="badges">
          <SectionHeading id="badges" description="Badges celebrate effort and milestones, never speed or ranking.">
            Badges
          </SectionHeading>
          <ul className="grid gap-2 sm:grid-cols-2">
            {p.badges.map((b) => (
              <li key={b.key} className={`flex gap-3 rounded-tile border p-3 ${b.earned ? "border-primary/50 bg-primary-soft/40" : "border-border bg-surface"}`}>
                {b.earned ? <Award className="size-6 shrink-0 text-primary" aria-hidden="true" /> : <CircleDashed className="size-6 shrink-0 text-text-secondary" aria-hidden="true" />}
                <span>
                  <span className="block font-semibold">
                    {b.name}
                    <span className="sr-only">{b.earned ? " (earned)" : " (not yet)"}</span>
                  </span>
                  <span className="block text-meta text-text-secondary">{b.description}</span>
                  {b.earned && b.awarded_at ? (
                    <span className="block text-meta text-text-secondary">
                      Earned {formatDay(b.awarded_at.slice(0, 10))}
                      {b.times && b.times > 1 ? ` · ${b.times} collections` : ""}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-heading" id="how" className="space-y-3 rounded-card border border-border bg-surface p-5">
          <SectionHeading id="how-heading">How progress works</SectionHeading>
          <p>Each practice records separate facts: that you completed it, the accuracy (for scored activities), any hints, how sure you felt, and what happened to the review schedule. They&apos;re never folded into one score.</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-semibold">Accuracy</span> (typing, missing words, word order) is checked on the church&apos;s server against the exact text of your Bible version: matched words ÷ (the verse&apos;s words + extra words you typed). Different words are never accepted; capital letters and punctuation follow your settings.
            </li>
            <li>
              <span className="font-semibold">Recall activities</span> ({ACTIVITIES.filter((a) => a.recall === "always").map((a) => a.label.toLowerCase()).join(", ")}, and the Challenge versions of missing words and word order) move a verse along the schedule. Learning activities help you get to know it.
            </li>
            <li>
              <span className="font-semibold">The schedule</span>: a verse you recall fully (every word, no hints, or &quot;word for word&quot; on a self-check) when it&apos;s due comes back after 1, 2, 4, 7, 14, 30, then 60 days. Partly recalled: the same step, sooner. A hard day: back one step, tomorrow. It changes at most once a day per verse, and reviewing early doesn&apos;t push it later.
            </li>
            <li>
              <span className="font-semibold">Review-ready</span> means you recalled a verse on three separate review days. It isn&apos;t a claim that it&apos;s memorized forever; well-known verses still come back every month or two.
            </li>
            <li>
              <span className="font-semibold">Missed days</span> never lower anything. Verses simply wait in your review queue.
            </li>
            <li>
              <span className="font-semibold">Self-check and flashcards</span> record your own judgment. They help plan reviews; they don&apos;t prove memorization.
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
