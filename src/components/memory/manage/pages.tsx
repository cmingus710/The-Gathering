import { notFound, redirect } from "next/navigation";
import { ChallengeView } from "@/components/memory/manage/challenge-view";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { todayIn } from "@/lib/bible/dates";
import { versionChoices } from "@/lib/memory/eligibility";
import { signMemoryPaths } from "@/lib/memory/storage";
import { allExercises } from "@/lib/memory/format";
import { sourceVerses } from "@/lib/memory/provider";
import type { Activity, Challenge, Difficulty, Segment, Session } from "@/lib/memory/types";
import { fetchPassageText } from "@/components/memory/licensed-passage";
import { requireClient } from "@/lib/supabase/server";
import { ChallengeForm } from "./challenge-form";
import { CollectionEditor } from "./collection-editor";
import { CollectionForm } from "./collection-form";
import { ManageHome } from "./manage-home";
import { ActivityPreview, LicensedPreview } from "./preview";
import type { AdminCollection, AdminHome, ManageBase } from "./types";

/**
 * Page bodies shared by /admin/memory (staff) and /memory/lead (authorized
 * group leaders). The database decides what each person may see and do;
 * someone without either right is sent away.
 */
async function load(base: ManageBase) {
  await requireApprovedMember(base);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_admin_home");
  if (error?.code === "42501") redirect(base === "/admin/memory" ? "/admin?notice=not-authorized" : "/memory");
  return { supabase, home: data as AdminHome | null, error };
}


const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function ManageHomePage({ base }: { base: ManageBase }) {
  const { supabase, home } = await load(base);
  if (!home) return <Alert tone="error" title="Memory verses couldn't be loaded right now." />;
  const { data } = await supabase.rpc("memory_admin_challenges");
  return (
    <>
      {base === "/memory/lead" ? <BackLink route="/memory/lead" /> : null}
      <ManageHome data={home} challenges={(data as Challenge[] | null) ?? []} base={base} />
    </>
  );
}

export async function NewCollectionPage({ base }: { base: ManageBase }) {
  const { home } = await load(base);
  if (!home) return <Alert tone="error" title="Memory verses couldn't be loaded right now." />;
  const leader = base === "/memory/lead";
  const choices = versionChoices(home.translations);
  const usable = choices.filter((t) => t.eligible);
  const defaultTranslation = usable.some((t) => t.id === home.default_translation_id) ? home.default_translation_id : (usable[0]?.id ?? null);
  return (
    <>
      <BackLink route={`${base}/collections/new`} />
      <PageHeader title="New collection" description="Start with the details; then add verses by reference from the approved Bible source." />
      {!usable.length ? (
        <Alert tone="info" title="No Bible version is available for memory verses yet.">
          {choices.length ? choices.map((t) => t.note).join(" ") : "Publish a Bible version first."}
        </Alert>
      ) : (
        <Card>
          <CollectionForm
            base={base}
            translations={choices}
            defaultTranslation={defaultTranslation}
            groups={leader ? home.led_groups : home.groups.map((g) => ({ id: g.id, name: g.name }))}
            leaderOnly={leader}
            timezone={home.church_timezone}
          />
        </Card>
      )}
    </>
  );
}

export async function CollectionPage({ base, id, preview }: { base: ManageBase; id: string; preview?: string | null }) {
  if (!isUuid(id)) notFound();
  const { supabase, home } = await load(base);
  const { data, error } = await supabase.rpc("memory_admin_collection", { p_id: id });
  if (error?.code === "P0002") notFound();
  const c = data as AdminCollection | null;
  if (!c || !home) return <Alert tone="error" title="This collection couldn't be loaded right now." />;
  const cover = c.cover_path ? (await signMemoryPaths(supabase, [c.cover_path])).get(c.cover_path) : undefined;
  return (
    <>
      <BackLink route={`${base}/collections/[id]`} />
      <PageHeader title={c.title} description={c.description || undefined} />
      <CollectionEditor c={c} home={home} base={base} coverUrl={cover} preview={preview ?? null} />
    </>
  );
}

export async function PreviewPage({ base, id, searchParams }: { base: ManageBase; id: string; searchParams: Record<string, string | string[] | undefined> }) {
  if (!isUuid(id)) notFound();
  const { supabase } = await load(base);
  const { data, error } = await supabase.rpc("memory_admin_collection", { p_id: id });
  if (error?.code === "P0002") notFound();
  const c = data as AdminCollection | null;
  if (!c) return <Alert tone="error" title="This collection couldn't be loaded right now." />;
  const items = c.items.filter((i) => !i.retired);
  const item = items.find((i) => i.id === one(searchParams.item)) ?? items[0];
  if (!item) return <Alert tone="info" title="Add a verse to preview activities." />;
  const licensed = item.passage.source_kind === "api";
  // A licensed version with unchanged-text practice only: the fetched text
  // and what members can do with it.
  if (licensed && !allExercises(c.translation.memory_modes)) {
    return (
      <>
        <BackLink route={`${base}/collections/[id]/preview`} params={{ id: c.id }} label={c.title} />
        <PageHeader title="Preview activities" description="Exactly what members will see. Nothing here is recorded." />
        <LicensedPreview base={base} collectionId={c.id} items={items} item={item} modes={c.translation.memory_modes ?? []} />
      </>
    );
  }
  const activity = (["read_repeat", "flashcards", "missing_words", "word_order", "type_verse", "self_check"].includes(one(searchParams.activity)) ? one(searchParams.activity) : "missing_words") as Activity;
  const difficulty = (["guided", "growing", "challenge"].includes(one(searchParams.difficulty)) ? one(searchParams.difficulty) : "guided") as Difficulty;
  const short = one(searchParams.short) === "1";
  const segment = Math.max(0, Number(one(searchParams.segment)) || 0);
  const tooLong = segment === 0 && item.passage.word_count > 80 && ["missing_words", "word_order", "type_verse"].includes(activity);
  // A licensed version with all six activities: the same preview, built from
  // the server's fetch (held in memory only; the display is reported to FUMS).
  const text = licensed ? await fetchPassageText(item.passage) : null;
  if (text && text.status !== "ok") {
    return (
      <>
        <BackLink route={`${base}/collections/[id]/preview`} params={{ id: c.id }} label={c.title} />
        <PageHeader title="Preview activities" />
        <Alert tone="info" title={text.status === "stored" ? "This verse can't be previewed right now." : text.message} />
      </>
    );
  }
  const preview = tooLong
    ? null
    : await supabase
        .rpc("memory_admin_preview", {
          p_item: item.id,
          p_activity: activity,
          p_difficulty: difficulty,
          p_segment: segment,
          p_short: short,
          ...(text?.status === "ok" ? { p_source: sourceVerses(text.verses) } : {}),
        })
        .then(({ data: d, error: e }) => (e ? null : (d as Session & { hidden: { blanks?: number[] }; parts?: { segments: Segment[] | null; short_segments: Segment[] | null } })));
  return (
    <>
      <BackLink route={`${base}/collections/[id]/preview`} params={{ id: c.id }} label={c.title} />
      <PageHeader title="Preview activities" description="Exactly what members will see (choices and shuffles change each time). Nothing here is recorded." />
      <ActivityPreview
        base={base}
        collectionId={c.id}
        items={items}
        item={item}
        activity={activity}
        difficulty={difficulty}
        segment={segment}
        short={short}
        preview={preview}
        activities={licensed ? c.translation.memory_modes : undefined}
        parts={preview?.parts}
        licensed={text?.status === "ok" ? { copyright: text.copyright, fumsId: text.fumsId } : undefined}
      />
    </>
  );
}

export async function NewChallengePage({ base }: { base: ManageBase }) {
  const { home } = await load(base);
  if (!home) return <Alert tone="error" title="Memory verses couldn't be loaded right now." />;
  const leader = base === "/memory/lead";
  const groups = leader ? home.led_groups : home.groups.map((g) => ({ id: g.id, name: g.name }));
  const collections = home.collections.filter((c) => c.status === "published");
  return (
    <>
      <BackLink route={`${base}/challenges/new`} />
      <PageHeader title="New group challenge" description="Members join only if they choose to, and see only a shared total once enough people share. Adults only; family challenges arrive with Phase 10." />
      {!home.can_publish && !leader ? (
        <Alert tone="info" title="Only memory verse publishers and authorized group leaders can run challenges." />
      ) : !collections.length ? (
        <Alert tone="info" title="Publish a collection first." />
      ) : (
        <Card>
          <ChallengeForm base={base} groups={groups} collections={collections.map((c) => ({ id: c.id, title: c.title, audience: c.audience, group_id: c.group_id }))} today={todayIn(home.church_timezone)} />
        </Card>
      )}
    </>
  );
}

export async function ChallengePage({ base, id }: { base: ManageBase; id: string }) {
  if (!isUuid(id)) notFound();
  const { supabase } = await load(base);
  const { data } = await supabase.rpc("memory_admin_challenges");
  const ch = ((data as Challenge[] | null) ?? []).find((x) => x.id === id);
  if (!ch) notFound();
  return (
    <>
      <BackLink route={`${base}/challenges/[id]`} />
      <PageHeader eyebrow={`${ch.group?.name ?? "Group"} challenge`} title={ch.title} />
      <ChallengeView base={base} challenge={ch} />
    </>
  );
}
