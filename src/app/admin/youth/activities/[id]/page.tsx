import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { ActivityArtItem, ActivityArtUpload, ActivityEditorForm, ActivityStatusForm, type EditorDefaults } from "@/components/youth/activity-editor";
import { ColoringEditor } from "@/components/youth/coloring/editor";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { timeZoneLabel, utcToZonedLocal } from "@/lib/time";
import { ACTIVITY_STATUS } from "@/lib/youth/activities";
import { ART_MAX_UPLOAD_BYTES, signActivityArt } from "@/lib/youth/activity-art";
import { lineArtPath, templateFromConfig } from "@/lib/youth/coloring";
import { formatDay } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Edit activity" };

type Version = Omit<EditorDefaults, "available_from" | "available_until"> & {
  version: number;
  version_id: string;
  state: string;
  published_at: string | null;
  published_by: string | null;
  updated_by: string | null;
  config: Record<string, unknown>;
};

type Asset = {
  id: string;
  path: string;
  alt: string;
  source_kind: string;
  source_credit: string;
  license: string;
  source_url: string | null;
  rights_confirmed_by: string | null;
  rights_confirmed_at: string;
  locked: boolean;
};

type Admin = {
  id: string;
  status: string;
  live: boolean;
  available_from: string | null;
  available_until: string | null;
  published: Version | null;
  draft: Version | null;
  versions: Array<{ id: string; version: number; state: string; title: string; change_note: string; published_at: string | null; published_by: string | null }>;
  assets: Asset[];
  group_ids: string[];
  group_options: Array<{ id: string; name: string }>;
  progress_on_published: number;
};

export default async function EditActivityPage({ params, searchParams }: PageProps<"/admin/youth/activities/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireCapability(CAPABILITIES.youthActivities, `/admin/youth/activities/${id}`);
  const sp = await searchParams;
  const [{ data: a }, { settings }] = await Promise.all([youthRead<Admin>("youth_admin_activity", { p_id: id }), getChurchSettings()]);
  if (!a) return <Alert tone="error" title="This activity couldn't be loaded right now." />;
  const supabase = await requireClient();
  const urls = await signActivityArt(supabase, a.assets.map((x) => x.path));
  const source = a.draft ?? a.published;
  const st = ACTIVITY_STATUS[a.status] ?? ACTIVITY_STATUS.draft;
  const tz = settings.timezone;
  const archived = a.status === "archived";
  const coloring = source ? templateFromConfig(source.config) : null;
  const coloringArt = coloring ? lineArtPath(a.id, coloring) : null;

  return (
    <div className="layout-wide space-y-8">
      <p className="-mt-1">
        <Link href="/admin/youth/activities" className="inline-flex min-h-11 items-center text-meta font-semibold text-text-secondary hover:text-text hover:underline">
          ‹ Learn &amp; Play activities
        </Link>
      </p>
      <PageHeader
        title={source?.title ?? "Activity"}
        eyebrow={<Badge tone={st.tone}>{st.label}</Badge>}
        description={[
          a.published ? `Version ${a.published.version} published ${formatDay(a.published.published_at)}` : "Never published",
          a.draft && a.published ? `unpublished changes in version ${a.draft.version}` : null,
          a.status === "published" && !a.live ? "outside its availability window, so members don't see it" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          source ? (
            <ButtonLink href={`/admin/youth/activities/${a.id}/preview`} variant="secondary">
              Preview
            </ButtonLink>
          ) : undefined
        }
      />
      {sp.created ? <Alert tone="success" title="Draft created. Add artwork, preview it, and publish when it's ready." /> : null}

      <section aria-labelledby="lifecycle" className="space-y-3">
        <SectionHeading id="lifecycle">Publishing</SectionHeading>
        <Card className="grid gap-6 md:grid-cols-2">
          {archived ? (
            <ActivityStatusForm activityId={a.id} action="restore" submit="Restore">
              <p className="text-meta text-text-secondary">Restoring brings it back as it was{a.published ? ": members who may play it see it again." : " (still a draft)."}</p>
            </ActivityStatusForm>
          ) : (
            <>
              {a.draft ? (
                a.draft.state === "preview" ? (
                  <ActivityStatusForm activityId={a.id} action="unready" submit="Back to draft">
                    <p className="text-meta text-text-secondary">Version {a.draft.version} is marked ready for preview. Editing it also returns it to draft.</p>
                  </ActivityStatusForm>
                ) : (
                  <ActivityStatusForm activityId={a.id} action="ready" submit="Mark ready for preview">
                    <p className="text-meta text-text-secondary">Lets other editors know version {a.draft.version} is ready to check. Members still can&apos;t see it.</p>
                  </ActivityStatusForm>
                )
              ) : null}
              {a.draft ? (
                <ActivityStatusForm activityId={a.id} action="publish" submit={`Publish version ${a.draft.version}`} confirmWord="publish" variant="primary">
                  <p className="text-meta text-text-secondary">
                    {a.published
                      ? `Replaces version ${a.published.version} for members. ${a.progress_on_published ? `${a.progress_on_published} ${a.progress_on_published === 1 ? "child has" : "children have"} progress on version ${a.published.version}: it's kept with that version, and they start the new one fresh.` : ""}`
                      : "Members who may play it see it as soon as it's published (and inside its availability window)."}
                  </p>
                </ActivityStatusForm>
              ) : (
                <p className="text-meta text-text-secondary">No unpublished changes. Saving the editor below starts a new draft version; members keep seeing version {a.published?.version} until you publish it.</p>
              )}
              {a.draft && a.published ? (
                <ActivityStatusForm activityId={a.id} action="discard_draft" submit="Discard unpublished changes" variant="danger-outline" />
              ) : null}
              <ActivityStatusForm activityId={a.id} action="archive" submit="Archive" confirmWord="archive" variant="danger-outline">
                <p className="text-meta text-text-secondary">Hides it from members. Versions, artwork, and children&apos;s progress are kept.</p>
              </ActivityStatusForm>
            </>
          )}
        </Card>
      </section>

      {archived ? null : (
        <section aria-labelledby="editor" className="space-y-3">
          <SectionHeading id="editor" description={a.draft ? `Editing draft version ${a.draft.version}.` : a.published ? `Changes make version ${a.versions[0].version + 1}.` : undefined}>
            Content
          </SectionHeading>
          {source ? (
            <ActivityEditorForm
              activityId={a.id}
              groups={a.group_options}
              groupIds={a.group_ids}
              timeZoneLabel={`Church time (${timeZoneLabel(tz)})`}
              art={a.assets.map((x) => ({ id: x.id, url: urls.get(x.path) ?? null, alt: x.alt, source: x.source_kind }))}
              defaults={{ ...source, available_from: utcToZonedLocal(a.available_from, tz), available_until: utcToZonedLocal(a.available_until, tz) }}
            />
          ) : null}
        </section>
      )}

      {archived || !source ? null : (
        <section aria-labelledby="coloring" className="space-y-3">
          <SectionHeading
            id="coloring"
            description={a.draft ? `Changes go into draft version ${a.draft.version}.` : a.published ? `Changes make version ${a.versions[0].version + 1}.` : undefined}
          >
            Coloring picture
          </SectionHeading>
          <ColoringEditor
            activityId={a.id}
            kind={source.kind}
            current={coloring}
            currentLineArtUrl={coloringArt ? (urls.get(coloringArt) ?? null) : null}
            art={a.assets.map((x) => ({ id: x.id, url: urls.get(x.path) ?? null, alt: x.alt }))}
          />
        </section>
      )}

      <section aria-labelledby="art" className="space-y-3">
        <SectionHeading id="art" description="Original or appropriately licensed artwork only. Every image needs its source recorded; meaningful images need a description.">
          Artwork
        </SectionHeading>
        {archived ? null : (
          <Card>
            <ActivityArtUpload activityId={a.id} maxMb={Math.round(ART_MAX_UPLOAD_BYTES / 1024 / 1024)} />
          </Card>
        )}
        {a.assets.length ? (
          <ul className="space-y-3">
            {a.assets.map((x) => (
              <ActivityArtItem key={x.id} activityId={a.id} asset={x} url={urls.get(x.path) ?? null} locked={x.locked} />
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="history">
        <SectionHeading id="history">Version history</SectionHeading>
        <ul className="space-y-1 text-meta">
          {a.versions.map((v) => (
            <li key={v.id}>
              Version {v.version} · {v.state === "published" ? `published ${formatDay(v.published_at)}` : v.state === "retired" ? `replaced (published ${formatDay(v.published_at)})` : v.state === "preview" ? "ready for preview" : "draft"}
              {v.published_by ? ` by ${v.published_by}` : ""}
              {v.change_note ? ` · ${v.change_note}` : ""}
              {v.state === "published" || v.state === "retired" ? (
                <>
                  {" · "}
                  <Link href={`/admin/youth/activities/${a.id}/preview?version=${v.id}`} className="font-semibold text-primary hover:underline">
                    Preview
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
