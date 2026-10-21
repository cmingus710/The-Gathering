import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { StateBadge } from "@/components/youth/state-badge";
import { YouthForm } from "@/components/youth/youth-form";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { MEDIA_STATE, formatWhen } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Photo consent" };

type Photo = {
  id: string;
  album: string;
  event: string | null;
  youth_event: boolean;
  status: string;
  minors: string;
  created_at: string;
  subjects: Array<{ child_id: string; display_name: string; state: string }>;
  reuse: Array<{ id: string; kind: string; location: string; recorded_at: string; removed_at: string | null }>;
  problem: string | null;
};
type Queue = { reviews: Array<{ id: string; reason: string; created_at: string; child: string | null; photo: Photo }>; pending: Photo[] };

const REASONS: Record<string, string> = {
  consent_withdrawn: "Consent withdrawn",
  consent_declined: "Consent declined",
  consent_unknown: "No consent decision",
  consent_conflict: "Guardians disagree",
  guardian_changed: "Guardian changed",
};

function PhotoCard({ photo, children }: { photo: Photo; children?: React.ReactNode }) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{photo.album}</p>
          <p className="text-meta text-text-secondary">
            {photo.event ? `${photo.event} · ` : ""}uploaded {formatWhen(photo.created_at)} · status {photo.status}
          </p>
        </div>
        <a className="text-meta font-semibold text-primary hover:underline" href={`/admin/youth/media?photo=${photo.id}`}>
          Associations
        </a>
      </div>
      <ul className="flex flex-wrap gap-2">
        {photo.subjects.map((s) => (
          <li key={s.child_id} className="flex items-center gap-1.5">
            <span>{s.display_name}</span>
            <StateBadge map={MEDIA_STATE} value={s.state} />
          </li>
        ))}
        {photo.subjects.length === 0 ? <li className="text-meta text-text-secondary">No children associated.</li> : null}
      </ul>
      {children}
    </Card>
  );
}

export default async function MediaConsentPage({ searchParams }: PageProps<"/admin/youth/media">) {
  await requireCapability(CAPABILITIES.youthMediaConsent, "/admin/youth/media");
  const sp = await searchParams;
  const photoId = isUuid(sp.photo) ? sp.photo : null;
  const q = String(sp.q ?? "").slice(0, 60);
  const [{ data, failed }, photo, children] = await Promise.all([
    youthRead<Queue>("youth_admin_media_queue"),
    photoId ? youthRead<Photo>("youth_admin_photo", { p_photo: photoId }) : Promise.resolve({ data: null }),
    photoId && q.length >= 2 ? youthRead<Array<{ id: string; display_name: string; state: string }>>("youth_admin_media_children", { p_query: q }) : Promise.resolve({ data: null }),
  ]);
  return (
    <>
      <PageHeader
        title="Photo consent"
        description="Link photos to the children shown, by hand (nothing recognizes faces). A photo can't be published, or unhidden, until every linked child has member-gallery consent for that album's event. To view the images, also hold the Gallery moderator role."
      />
      {failed || !data ? <Alert tone="error" title="The review queue couldn't be loaded right now." /> : null}
      <div className="space-y-10">
        {photo.data ? (
          <section aria-labelledby="photo">
            <SectionHeading id="photo">Associations for this photo</SectionHeading>
            <PhotoCard photo={photo.data}>
              {photo.data.subjects.map((s) => (
                <YouthForm key={s.child_id} op="photo_subject" hidden={{ photo: photo.data!.id, child: s.child_id, on: "false" }} submit={`Unlink ${s.display_name}`} size="sm" variant="secondary" inline />
              ))}
              <form role="search" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="photo" value={photo.data.id} />
                <TextField label="Find a child by preferred name" name="q" defaultValue={q} className="min-w-64 flex-1" />
                <button type="submit" className="min-h-12 rounded-full border border-border px-5 font-semibold">
                  Search
                </button>
              </form>
              {(children.data ?? []).map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {c.display_name} <StateBadge map={MEDIA_STATE} value={c.state} />
                  </span>
                  <YouthForm op="photo_subject" hidden={{ photo: photo.data!.id, child: c.id, on: "true" }} submit="Link to photo" size="sm" inline />
                </div>
              ))}
              <div className="border-t border-border pt-3">
                <h3 className="font-semibold">Known copies and public reuse</h3>
                <ul className="mt-2 space-y-1 text-meta">
                  {photo.data.reuse.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {r.kind === "public_reuse" ? "Public reuse" : "Copy"}: {r.location}
                        {r.removed_at ? " (removed)" : ""}
                      </span>
                      {!r.removed_at ? <YouthForm op="reuse" hidden={{ photo: photo.data!.id, remove: r.id }} submit="Mark removed" size="sm" variant="ghost" inline /> : null}
                    </li>
                  ))}
                </ul>
                <YouthForm op="reuse" hidden={{ photo: photo.data.id }} submit="Record" size="sm" className="mt-2 space-y-2">
                  <SelectField label="Kind" name="kind" defaultValue="derivative">
                    <option value="derivative">A copy or edited version</option>
                    <option value="public_reuse">Used publicly (website, social media, print)</option>
                  </SelectField>
                  <TextField label="Where" name="location" maxLength={300} required />
                </YouthForm>
              </div>
            </PhotoCard>
          </section>
        ) : null}

        <section aria-labelledby="reviews">
          <SectionHeading id="reviews">Consent reviews ({data?.reviews.length ?? 0})</SectionHeading>
          {(data?.reviews ?? []).length === 0 ? (
            <EmptyState glyph="gallery" title="Nothing to review" />
          ) : (
            <ul className="space-y-4">
              {data!.reviews.map((r) => (
                <li key={r.id}>
                  <PhotoCard photo={r.photo}>
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone="warning">{REASONS[r.reason] ?? r.reason}</Badge>
                      <span className="text-meta">{r.child}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <YouthForm op="review_resolve" hidden={{ id: r.id, outcome: "kept_hidden" }} submit="Keep hidden" size="sm" variant="secondary" inline />
                      <YouthForm op="review_resolve" hidden={{ id: r.id, outcome: "restored" }} submit="Restore (consent confirmed)" size="sm" variant="secondary" inline />
                      <YouthForm op="review_resolve" hidden={{ id: r.id, outcome: "removed" }} submit="Remove photo" size="sm" variant="danger-outline" inline />
                    </div>
                  </PhotoCard>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="pending">
          <SectionHeading id="pending" description="Photos waiting for gallery approval in albums linked to youth events.">
            Waiting for approval
          </SectionHeading>
          {(data?.pending ?? []).length === 0 ? (
            <p className="text-meta text-text-secondary">None.</p>
          ) : (
            <ul className="space-y-3">
              {data!.pending.map((p) => (
                <li key={p.id}>
                  <PhotoCard photo={p}>{p.problem ? <Badge tone="warning">Consent not confirmed for everyone linked</Badge> : null}</PhotoCard>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
