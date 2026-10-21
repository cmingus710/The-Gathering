import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PracticeRunner } from "@/components/memory/practice/runner";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import { ACTIVITIES } from "@/lib/memory/format";
import type { Activity, CardDetail, Difficulty } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Practice" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PracticePage({ params, searchParams }: PageProps<"/memory/practice/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireLearner(`/memory/practice/${id}`);
  const supabase = await requireClient();
  const [{ data, error }, q] = await Promise.all([supabase.rpc("memory_card", { p_id: id }), supabase.rpc("memory_review_queue")]);
  if (error?.code === "P0002" || (error && /invalid input syntax/.test(error.message))) notFound();
  const c = data as CardDetail | null;
  if (!c) return <Alert tone="error" title="This verse couldn't be loaded right now." />;
  const today = (q.data as { today: string } | null)?.today ?? new Date().toISOString().slice(0, 10);
  const activity = ACTIVITIES.some((a) => a.key === one(sp.activity)) ? (one(sp.activity) as Activity) : c.due ? "self_check" : "read_repeat";
  const difficulty = (["guided", "growing", "challenge"].includes(one(sp.difficulty) ?? "") ? one(sp.difficulty) : c.settings.difficulty) as Difficulty;
  const segment = Math.max(0, Number(one(sp.segment) ?? 0) || 0);
  return (
    <>
      <Link href={`/memory/verses/${c.id}`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> {c.passage.label}
      </Link>
      <PageHeader title="Practice" description={`${c.passage.label} (${c.passage.translation.code}). Take your time; nothing here is timed.`} />
      {c.status !== "active" || !c.translation_available ? (
        <Alert tone="info" title="This verse can't be practiced right now." />
      ) : (
        <PracticeRunner
          card={{
            id: c.id,
            label: c.passage.label,
            code: c.passage.translation.code,
            wordCount: c.passage.word_count,
            segments: c.passage.segments,
            shortSegments: c.passage.short_segments,
            hint: c.item?.hint ?? null,
          }}
          settings={c.settings}
          today={today}
          initial={{ activity, difficulty, segment, direction: one(sp.direction) === "text_to_ref" ? "text_to_ref" : "ref_to_text" }}
        />
      )}
    </>
  );
}
