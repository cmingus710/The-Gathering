import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { deleteTopicAction, savePersonAction } from "../actions";
import type { AssetChoice, Taxonomy } from "../editor-data";
import { SeriesForm } from "./series-form";

export const metadata: Metadata = { title: "Series, people, topics" };

export default async function TaxonomyPage({ searchParams }: PageProps<"/admin/content/library">) {
  const viewer = await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content/library");
  const sp = await searchParams;
  const supabase = await requireClient();
  const [tax, images] = await Promise.all([
    supabase.rpc("media_admin_taxonomy"),
    supabase.rpc("media_admin_assets", { p_kind: "image", p_status: "ready", p_q: null, p_limit: 100, p_offset: 0 }),
  ]);
  const t = (tax.data ?? { series: [], people: [], topics: [] }) as Taxonomy;
  const covers = ((images.data as { items: AssetChoice[] } | null)?.items ?? []) as AssetChoice[];
  const canEdit = viewer.capabilities.has(CAPABILITIES.contentEdit);
  const canDeleteTopics = viewer.capabilities.has(CAPABILITIES.contentPublish);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/content" className="hover:underline">
            Teaching content
          </Link>
        }
        title="Series, people, and topics"
        description="Used to organize the lesson archive and search. People here are names only, not member profiles."
      />
      {typeof sp.saved === "string" ? <Alert tone="success" title="Saved." className="mb-6" /> : null}
      {tax.error ? <Alert tone="error" title="This list couldn't be loaded." className="mb-6" /> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <SectionHeading description="Series pages show every published item in the series that a member can see.">Series</SectionHeading>
          <div className="space-y-4">
            {t.series.map((s) => (
              <details key={s.id} className="rounded-tile border border-border p-3">
                <summary className="cursor-pointer font-semibold">
                  {s.title} <span className="font-normal text-text-secondary">· {s.items} item(s){s.archived ? " · archived" : ""}</span>
                </summary>
                <div className="mt-3">{canEdit ? <SeriesForm series={s} covers={covers} /> : null}</div>
              </details>
            ))}
            {canEdit ? (
              <details className="rounded-tile border border-dashed border-border p-3" open={!t.series.length}>
                <summary className="cursor-pointer font-semibold text-primary">Add a series</summary>
                <div className="mt-3">
                  <SeriesForm series={null} covers={covers} />
                </div>
              </details>
            ) : null}
          </div>
        </Card>
        <Card>
          <SectionHeading description="Speakers, authors, and hosts are added automatically when you save content.">People</SectionHeading>
          <ul className="divide-y divide-border">
            {t.people.map((p) => (
              <li key={p.id} className="py-2">
                {canEdit ? (
                  <form action={savePersonAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <label htmlFor={`person-${p.id}`} className="sr-only">
                      Name
                    </label>
                    <input id={`person-${p.id}`} name="name" defaultValue={p.name} maxLength={120} className="min-h-11 min-w-40 flex-1 rounded-control border border-border-strong bg-surface px-3" />
                    <label className="flex items-center gap-1.5 text-meta">
                      <input type="checkbox" name="archived" defaultChecked={p.archived} className="size-5 accent-primary" /> Hidden
                    </label>
                    <span className="text-meta text-text-secondary">{p.items} item(s)</span>
                    <SubmitButton size="sm" variant="secondary">
                      Save
                    </SubmitButton>
                  </form>
                ) : (
                  p.name
                )}
              </li>
            ))}
            {!t.people.length ? <li className="py-2 text-text-secondary">None yet.</li> : null}
          </ul>
        </Card>
        <Card>
          <SectionHeading description="Topics are added from the content editor.">Topics</SectionHeading>
          <ul className="flex flex-wrap gap-2">
            {t.topics.map((topic) => (
              <li key={topic.id} className="flex items-center gap-1 rounded-full border border-border bg-surface-muted pl-3">
                <span>
                  {topic.name} <span className="text-meta text-text-secondary">({topic.items})</span>
                </span>
                {canDeleteTopics ? (
                  <ConfirmDialog
                    triggerVariant="ghost"
                    trigger={
                      <>
                        <span aria-hidden="true">×</span>
                        <span className="sr-only">Delete topic {topic.name}</span>
                      </>
                    }
                    title={`Delete the topic “${topic.name}”?`}
                    confirmLabel="Delete topic"
                    formAction={deleteTopicAction}
                    hidden={{ id: topic.id }}
                  >
                    It is removed from {topic.items === 1 ? "1 item" : `${topic.items} items`}. This can&apos;t be undone.
                  </ConfirmDialog>
                ) : (
                  <span className="pr-3" />
                )}
              </li>
            ))}
            {!t.topics.length ? <li className="text-text-secondary">None yet.</li> : null}
          </ul>
        </Card>
      </div>
    </>
  );
}
