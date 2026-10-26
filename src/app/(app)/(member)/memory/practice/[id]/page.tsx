import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PracticeRunner } from "@/components/memory/practice/runner";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import { ACTIVITIES } from "@/lib/memory/format";
import { fetchMemoryText, sourceVerses } from "@/lib/memory/provider";
import type { Activity, CardDetail, Difficulty, Segment } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Practice" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type Parts = { word_count: number; segments: Segment[] | null; short_segments: Segment[] | null };

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
  // A licensed version keeps no text or parts: the passage is fetched here
  // (the existing integration and its cache; not a member view, so nothing is
  // reported to FUMS) and the database works out its parts from it.
  let parts: Parts | null = null;
  let unavailable: string | null = null;
  if (c.provider && c.status === "active" && c.modes.length) {
    const p = c.passage;
    const text = await fetchMemoryText(supabase, p.translation.id, { book: p.book, sc: p.start_chapter, sv: p.start_verse, ec: p.end_chapter, ev: p.end_verse });
    if (text.status !== "ok") unavailable = text.status === "stored" ? "This verse can't be practiced right now." : text.message;
    else {
      const r = await supabase.rpc("memory_card_parts", { p_card: c.id, p_source: sourceVerses(text.verses) });
      if (r.error) unavailable = r.error.code === "P0010" ? r.error.message : "This verse can't be practiced right now. Try again later.";
      else parts = r.data as Parts;
    }
  }
  return (
    <>
      <BackLink route="/memory/practice/[id]" params={{ id: c.id }} label={c.passage.label} />
      <PageHeader title="Practice" description={`${c.passage.label} (${c.passage.translation.code}). Take your time; nothing here is timed.`} />
      {c.status !== "active" || !c.translation_available || !c.modes.length ? (
        <Alert tone="info" title="This verse can't be practiced right now." />
      ) : unavailable ? (
        <Alert tone="info" title={unavailable}>
          <p>Your progress is kept, and no other version is used instead.</p>
        </Alert>
      ) : (
        <PracticeRunner
          card={{
            id: c.id,
            label: c.passage.label,
            code: c.passage.translation.code,
            wordCount: parts?.word_count ?? c.passage.word_count,
            segments: parts?.segments ?? c.passage.segments ?? [],
            shortSegments: parts?.short_segments ?? c.passage.short_segments ?? [],
            hint: c.item?.hint ?? null,
            modes: c.modes,
            provider: c.provider,
          }}
          settings={c.settings}
          today={today}
          initial={{ activity, difficulty, segment, direction: one(sp.direction) === "text_to_ref" ? "text_to_ref" : "ref_to_text" }}
        />
      )}
    </>
  );
}
