import { Bell, BellOff, CheckCircle2, EyeOff, Lock, MessageCircleOff, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CommunityText } from "@/components/community/community-text";
import { LiveRefresh } from "@/components/community/live-refresh";
import { ToggleForm } from "@/components/community/toggle-form";
import { CommentFocus } from "@/components/prayer/comment-focus";
import { CommentComposer, CommentItem, UpdateComposer, UpdateItem } from "@/components/prayer/conversation";
import { AuthorStatusControls, IdentityLookup, RequestModeration } from "@/components/prayer/controls";
import { PrayButton } from "@/components/prayer/pray-button";
import { AudienceTag } from "@/components/prayer/prayer-row";
import { PrayerReportDialog } from "@/components/prayer/report-dialog";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { exactTime, relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { AUDIENCE_LABEL, audienceDescription, STATUS_LABEL } from "@/lib/prayer/format";
import type { PrayerDetail } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { followAction, setCommentsAction } from "../actions";

// A generic title: request titles never go into the document title, tab
// names, or browser history.
export const metadata: Metadata = { title: "Prayer request" };

const UUID = /^[0-9a-f-]{36}$/;

const SAVED: Record<string, string> = {
  shared: "Your request is shared.",
  draft: "Your private draft is saved. Only you can see it.",
  edited: "Your changes are saved.",
};

export default async function PrayerRequestPage({ params, searchParams }: PageProps<"/prayer/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/prayer/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  // A link to one comment (a mention notification) opens enough of the
  // conversation to show it; the position is counted among the comments
  // this reader may see, so it never reveals others.
  const focus = typeof sp.comment === "string" && UUID.test(sp.comment) ? sp.comment : null;
  const position = focus ? await tryCommunityRpc<number>("prayer_comment_position", { p_request: id, p_comment: focus }) : null;
  const n = Math.min(Math.max(Number(sp.n) || 50, position ? Math.ceil(position / 50) * 50 : 50, 50), 1000);
  const [r, { settings }] = await Promise.all([tryCommunityRpc<PrayerDetail>("prayer_request", { p_id: id, p_limit: n }), getChurchSettings()]);
  // Missing, hidden, archived, or outside the reader's audience: the same "not found".
  if (!r) notFound();
  const focusShown = !!focus && r.comments.some((c) => c.id === focus);
  const tz = settings.timezone;
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const published = r.audience !== "private";
  const commentsClosedReason = r.mod_locked
    ? "A prayer moderator has turned off comments on this request."
    : !r.comments_enabled
      ? "The requester has turned off comments."
      : r.status === "closed" || r.status === "archived"
        ? "This request is closed, so it isn't taking new comments."
        : r.posting_restricted
          ? "Your community posting is paused by a moderator. You can still read and pray."
          : null;

  return (
    <>
      <LiveRefresh />
      <BackLink route="/prayer/[id]" />
      {saved ? <Alert tone="success" title={saved} className="mb-4" /> : null}
      {focus && !focusShown ? (
        <Alert tone="info" title="That comment isn't available" className="mb-4">
          It may have been removed or hidden, or it was shared with a smaller audience before this request was widened.
        </Alert>
      ) : null}

      <article aria-labelledby="request-title" className="space-y-5">
        <header>
          <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta font-semibold">
            <AudienceTag audience={r.audience} groupName={r.group?.name} />
            {r.status !== "open" ? (
              <span className="inline-flex items-center gap-1 text-text-secondary">
                {r.status === "answered" ? <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" /> : null}
                {STATUS_LABEL[r.status]}
              </span>
            ) : null}
          </p>
          <h1 id="request-title" className="font-display text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">
            {r.title}
          </h1>
          <p className="mt-2 text-meta text-text-secondary">
            {r.mine ? `You${r.anonymous ? " (readers see “Anonymous”)" : ""}` : r.author} ·{" "}
            <time dateTime={r.published_at ?? r.created_at} title={exactTime(r.published_at ?? r.created_at, tz)}>
              {relativeTime(r.published_at ?? r.created_at)}
            </time>
            {r.edited_at ? " · edited" : ""}
          </p>
        </header>

        {r.hidden ? (
          <Alert tone="warning" title="Hidden by a prayer moderator">
            Readers can&apos;t see this request. You can still see it because you wrote it. Check your notifications for the reason.
          </Alert>
        ) : null}
        {r.status === "archived" ? <Alert tone="info" title="Archived: only you can see this request." /> : null}
        {r.mine ? (
          <p className="flex items-start gap-2 rounded-tile border border-border bg-surface-muted px-4 py-3 text-meta">
            <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <strong>Who can see it:</strong> {audienceDescription(r.audience, r.group?.name)}
            </span>
          </p>
        ) : null}

        <Card>
          <CommunityText source={r.body} mentions={r.mentions} />
          {published && r.status !== "archived" ? (
            <div className="mt-5">
              <PrayButton requestId={r.id} initialCount={r.prayer_count} initialPraying={r.praying} disabled={!r.can_pray && !r.praying} />
            </div>
          ) : null}
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          {published && r.status !== "archived" ? (
            <ToggleForm
              action={followAction}
              hidden={{ requestId: r.id, on: String(!r.following) }}
              label={r.following ? "Following" : "Follow"}
              pressed={r.following}
              icon={r.following ? <Bell className="size-4" aria-hidden="true" /> : <BellOff className="size-4" aria-hidden="true" />}
              description={r.following ? "Stop notifications about updates and comments" : "Get notified about updates and comments"}
            />
          ) : null}
          {r.mine ? (
            <>
              {r.status !== "archived" ? (
                <ButtonLink href={`/prayer/${r.id}/edit`} variant="ghost" size="sm" icon={<Pencil className="size-4" aria-hidden="true" />}>
                  Edit or change audience
                </ButtonLink>
              ) : null}
              {published && r.status !== "archived" ? (
                <ToggleForm
                  action={setCommentsAction}
                  hidden={{ requestId: r.id, on: String(!r.comments_enabled) }}
                  label={r.comments_enabled ? "Turn comments off" : "Turn comments on"}
                  pressed={!r.comments_enabled}
                  icon={<MessageCircleOff className="size-4" aria-hidden="true" />}
                  description={r.comments_enabled ? "Stop new comments" : "Allow new comments"}
                />
              ) : null}
            </>
          ) : (
            <PrayerReportDialog type="request" id={r.id} what="this request" />
          )}
          {r.can_lookup ? <IdentityLookup requestId={r.id} /> : null}
        </div>
        {r.mine ? <AuthorStatusControls id={r.id} status={r.status} audience={r.audience} groupName={r.group?.name ?? null} /> : null}
        {r.can_moderate && !r.mine ? (
          <Card>
            <h2 className="mb-1 text-[1.0625rem] font-semibold">Prayer moderation</h2>
            <p className="mb-3 text-meta text-text-secondary">Actions are logged and the author is told, without your name.</p>
            <RequestModeration id={r.id} hidden={r.hidden} locked={r.mod_locked} />
          </Card>
        ) : null}
      </article>

      {published ? (
        <>
          <section aria-labelledby="updates-heading" className="mt-10 space-y-4">
            <h2 id="updates-heading" className="text-[1.0625rem] font-semibold">
              Updates
            </h2>
            {r.updates.length ? (
              <ol className="space-y-5">
                {r.updates.map((u) => (
                  <UpdateItem key={u.id} u={u} requestId={r.id} canEdit={r.mine && r.status !== "archived"} />
                ))}
              </ol>
            ) : (
              <p className="text-text-secondary">No updates yet.</p>
            )}
            {r.mine && r.status !== "archived" ? (
              <Card>
                <UpdateComposer requestId={r.id} anonymous={r.anonymous} />
              </Card>
            ) : null}
          </section>

          <section aria-labelledby="comments-heading" className="mt-10 space-y-4">
            <h2 id="comments-heading" className="text-[1.0625rem] font-semibold">
              {r.comment_count === 1 ? "1 comment" : `${r.comment_count} comments`}
            </h2>
            {r.withheld ? (
              <p className="flex items-start gap-2 text-meta text-text-secondary">
                <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Some earlier comments or updates were shared with a smaller audience before this request was widened, so they aren&apos;t shown here.
              </p>
            ) : null}
            {r.comments.length ? (
              <ol className="space-y-3">
                {r.comments.map((c) => (
                  <li key={c.id}>
                    <CommentItem c={c} requestId={r.id} canModerate={r.can_moderate} canEdit={!r.mod_locked && !r.hidden} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-card border border-border bg-surface px-5 py-4 text-text-secondary">No comments yet.</p>
            )}
            {r.comments_has_more ? (
              n < 1000 ? (
                <ButtonLink href={`/prayer/${r.id}?n=${n + 50}`} variant="secondary" size="sm" scroll={false}>
                  Show more comments
                </ButtonLink>
              ) : (
                <p className="text-text-secondary">The first 1,000 comments are shown.</p>
              )
            ) : null}
            {focusShown ? <CommentFocus id={focus!} /> : null}
            {r.can_comment ? (
              <Card>
                <CommentComposer
                  requestId={r.id}
                  anonymousRequester={r.mine && r.anonymous}
                  audienceLabel={r.audience === "group" ? (r.group?.name ?? "your group") : AUDIENCE_LABEL[r.audience].toLowerCase()}
                />
              </Card>
            ) : commentsClosedReason ? (
              <Alert tone="info" title={commentsClosedReason} />
            ) : null}
          </section>
        </>
      ) : (
        <Alert tone="info" title="This is a private draft" className="mt-8">
          Only you can see it. Choose “Edit or change audience” to share it when you&apos;re ready.
        </Alert>
      )}
    </>
  );
}
