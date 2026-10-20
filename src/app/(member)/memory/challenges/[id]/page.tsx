import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/memory/format";
import type { Challenge } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";
import { ChallengeControls } from "./controls";

export const metadata: Metadata = { title: "Group challenge" };

export default async function ChallengePage({ params }: PageProps<"/memory/challenges/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/memory/challenges/${id}`);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_challenge", { p_id: id });
  if (error?.code === "P0002" || (error && /invalid input syntax/.test(error.message))) notFound();
  const ch = data as Challenge | null;
  if (!ch) return <Alert tone="error" title="This challenge couldn't be loaded right now." />;
  const a = ch.aggregate;
  const joined = !!ch.me?.joined;
  return (
    <>
      <Link href="/memory" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Memory verses
      </Link>
      <PageHeader eyebrow={`${ch.group?.name ?? "Group"} challenge`} title={ch.title} description={`${formatDay(ch.starts_on)} – ${formatDay(ch.ends_on)}${ch.status !== "active" ? " · ended" : ""}`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {ch.description ? <p className="whitespace-pre-line">{ch.description}</p> : null}
          <Card>
            <SectionHeading id="together">Together so far</SectionHeading>
            {a.visible ? (
              <>
                <p className="text-[1.5rem] font-semibold">
                  {a.sessions} of {a.goal} practice activities
                </p>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`${a.percent}% of the shared goal`}>
                  <div className="h-full bg-primary" style={{ width: `${a.percent}%` }} />
                </div>
                <p className="mt-2 text-meta text-text-secondary">
                  {a.participants} people sharing · rounded down to the nearest 5 · counted through {a.through ? formatDay(a.through) : "yesterday"}
                </p>
              </>
            ) : (
              <p className="text-text-secondary">The group total appears once at least {a.min_participants} people are sharing, so nobody&apos;s practice can be singled out.</p>
            )}
          </Card>
          {ch.collection ? (
            <p>
              Verses:{" "}
              {ch.collection.visible ? (
                <Link href={`/memory/collections/${ch.collection.id}`} className="font-semibold text-primary hover:underline">
                  {ch.collection.title}
                </Link>
              ) : (
                ch.collection.title
              )}
            </p>
          ) : null}
        </div>
        <div className="space-y-4">
          <section aria-labelledby="shares" className="rounded-card border border-border bg-surface p-4">
            <SectionHeading id="shares" as="h2">
              What joining shares
            </SectionHeading>
            <ul className="list-disc space-y-1.5 pl-5 text-meta">
              <li>Only a count: practice activities you complete on this challenge&apos;s verses, from when you join until it ends, added to the group total.</li>
              <li>Never your name in the total, your accuracy, hints, confidence, missed days, or which verses you know.</li>
              <li>Group members can see that the challenge has participants once enough people share; leaders see the same totals as everyone.</li>
              <li>You can pause sharing or leave at any time. Your practice is then removed from the total straight away.</li>
              <li>There&apos;s no leaderboard and no ranking.</li>
            </ul>
          </section>
          {ch.status === "active" || joined ? <ChallengeControls id={ch.id} joined={joined} sharing={!!ch.me?.sharing} active={ch.status === "active"} /> : null}
        </div>
      </div>
    </>
  );
}
