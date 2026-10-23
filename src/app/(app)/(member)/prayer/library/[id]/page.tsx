import { Archive, BookOpen, ExternalLink, EyeOff, FilePen, Pencil, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CommunityText } from "@/components/community/community-text";
import { BookmarkButton, CategoryLabels } from "@/components/prayer/library-card";
import { CopyPrayerButton, LibraryAuthorControls, LibraryModeration, LibraryReportDialog } from "@/components/prayer/library-controls";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { exactTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { classifyHref } from "@/lib/links/policy";
import { copyText, KIND_PLURAL, type LibraryPrayer } from "@/lib/prayer/library";
import { getChurchSettings } from "@/lib/settings/queries";
import { formatDate } from "@/lib/time";

// A generic title, as for prayer requests: prayer titles stay out of tab names and history.
export const metadata: Metadata = { title: "Prayer Library" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SAVED: Record<string, string> = {
  published: "Your prayer is published in the library.",
  updated: "Your changes are saved.",
  draft: "Your draft is saved. Only you can see it.",
};

export default async function LibraryPrayerPage({ params, searchParams }: PageProps<"/prayer/library/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/prayer/library/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const [p, { settings }] = await Promise.all([tryCommunityRpc<LibraryPrayer>("prayer_library_prayer", { p_id: id }), getChurchSettings()]);
  // Missing, a draft, hidden, or archived (unless it's the reader's own): the same "not found".
  if (!p) notFound();
  const tz = settings.timezone;
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const visible = p.status === "published" && !p.hidden;
  const sourceLink = p.source_url && classifyHref(p.source_url)?.kind === "web" ? p.source_url : null;

  return (
    <>
      <BackLink route="/prayer/library/[id]" />
      {saved ? <Alert tone="success" title={saved} className="mb-4" /> : null}

      <article aria-labelledby="prayer-title" className="max-w-3xl space-y-5">
        <header className="space-y-2">
          <CategoryLabels categories={p.categories} />
          <h1 id="prayer-title" className="font-display text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">
            {p.title}
          </h1>
          <p className="text-meta text-text-secondary">
            Shared by {p.mine ? "you" : p.contributor}
            {p.published_at ? (
              <>
                {" · "}
                <time dateTime={p.published_at} title={exactTime(p.published_at, tz)}>
                  {formatDate(p.published_at, tz)}
                </time>
              </>
            ) : null}
            {p.edited_at ? " · edited" : ""}
          </p>
        </header>

        {p.hidden ? (
          <Alert tone="warning" title="Hidden by a prayer moderator">
            Members can&apos;t find or open this prayer. You can still see it because you shared it.
          </Alert>
        ) : null}
        {p.status === "archived" ? (
          <Alert tone="info" title={p.mod_archived ? "Archived by a prayer moderator: only you can see it." : "Archived: only you can see it."} />
        ) : null}
        {p.status === "draft" ? (
          <p className="flex items-start gap-2 rounded-tile border border-border bg-surface-muted px-4 py-3 text-meta">
            <FilePen className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <strong>Draft.</strong> Only you can see it until you publish it.
            </span>
          </p>
        ) : null}

        <Card className="space-y-5">
          <CommunityText source={p.body} className="text-[1.0625rem] leading-relaxed" />
          <div className="space-y-1 border-t border-border pt-4 text-meta">
            {p.origin === "shared" ? (
              <>
                <p className="flex items-start gap-1.5">
                  <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">By {p.source_name || "another author or source"}</span>
                    {sourceLink ? (
                      <>
                        {" · "}
                        <a href={sourceLink} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 font-semibold text-primary underline">
                          Source <ExternalLink className="size-3.5" aria-hidden="true" />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </>
                    ) : null}
                  </span>
                </p>
                <p className="flex items-start gap-1.5 text-text-secondary">
                  <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  Shared in the library by {p.mine ? "you" : p.contributor}
                </p>
              </>
            ) : (
              <p className="flex items-start gap-1.5">
                <UserRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="font-semibold">By {p.mine ? "you" : p.contributor}</span>, who shared it
                  {p.source_name ? ` · ${p.source_name}` : ""}
                  {sourceLink ? (
                    <>
                      {" · "}
                      <a href={sourceLink} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-primary underline">
                        Source<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </>
                  ) : null}
                </span>
              </p>
            )}
          </div>
          {p.scripture_refs.length ? (
            <div>
              <h2 className="mb-1.5 text-meta font-semibold uppercase tracking-wide text-text-secondary">Scripture</h2>
              <ul aria-label="Scripture references" className="flex flex-wrap gap-1.5">
                {p.scripture_refs.map((r) => (
                  <li key={r} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-meta font-semibold text-primary">
                    <BookOpen className="size-3.5" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.categories.some((c) => c.kind === "use") ? (
            <div>
              <h2 className="mb-1.5 text-meta font-semibold uppercase tracking-wide text-text-secondary">{KIND_PLURAL.use}</h2>
              <CategoryLabels categories={p.categories} kinds={["use"]} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-start gap-2">
            <CopyPrayerButton text={copyText(p, settings.churchName)} />
            {p.can_save ? <BookmarkButton prayerId={p.id} title={p.title} initialSaved={p.saved} /> : null}
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          {p.mine && p.can_edit && p.status !== "archived" ? (
            <ButtonLink href={`/prayer/library/${p.id}/edit`} variant="ghost" size="sm" icon={<Pencil className="size-4" aria-hidden="true" />}>
              Edit
            </ButtonLink>
          ) : null}
          {p.mine ? <LibraryAuthorControls id={p.id} status={p.status} modArchived={p.mod_archived} postingRestricted={p.posting_restricted} /> : null}
          {p.can_report ? <LibraryReportDialog id={p.id} reported={p.reported} /> : null}
        </div>

        {p.can_moderate ? (
          <section aria-labelledby="mod-heading" className="space-y-2 rounded-card border border-border bg-surface-muted p-4">
            <h2 id="mod-heading" className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-text-secondary">
              <EyeOff className="size-4" aria-hidden="true" /> Prayer moderation
            </h2>
            <LibraryModeration id={p.id} hidden={p.hidden} modArchived={p.mod_archived} status={p.status} />
          </section>
        ) : null}

        {!visible && p.mine && p.status === "archived" && p.mod_archived ? (
          <p className="flex items-center gap-1.5 text-meta text-text-secondary">
            <Archive className="size-4" aria-hidden="true" /> A prayer moderator can restore it if this was a mistake.
          </p>
        ) : null}
      </article>
    </>
  );
}
