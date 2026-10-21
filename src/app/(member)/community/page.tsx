import { Lock, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Feed, PinnedPosts } from "@/components/community/feed";
import { FeedComposer, type ComposerPlace } from "@/components/community/feed-composer";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/components/ui/cn";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { renderCommunityText } from "@/lib/community/format";
import { communityRpc, tryCommunityRpc } from "@/lib/community/queries";
import type { Category, FeedPage, GroupCard } from "@/lib/community/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Community" };

const UUID = /^[0-9a-f-]{36}$/;

/**
 * The Community feed. Members read posts right here, newest first, with a
 * compact filter row for church-wide categories and their own groups. The
 * database decides what each member may see (group membership, hidden and
 * deleted posts, suspended and youth accounts are refused).
 */
export default async function CommunityPage({ searchParams }: PageProps<"/community">) {
  const viewer = await requireApprovedMember("/community");
  const sp = await searchParams;
  const category = typeof sp.category === "string" && UUID.test(sp.category) ? sp.category : null;
  const group = !category && typeof sp.group === "string" && UUID.test(sp.group) ? sp.group : null;
  const posted = typeof sp.posted === "string" && UUID.test(sp.posted) ? sp.posted : null;

  const failure: { message: string | null } = { message: null };
  const [categories, groups, guidelines, feed, { settings }] = await Promise.all([
    tryCommunityRpc<Category[]>("community_categories"),
    tryCommunityRpc<{ mine: GroupCard[] }>("community_groups"),
    tryCommunityRpc<{ acked: boolean; posting_restricted: boolean }>("community_guidelines"),
    communityRpc<FeedPage>("community_feed", { p_category: category, p_group: group, p_cursor_at: null, p_cursor_id: null, p_limit: 10 }).catch((e: { code?: string }) => {
      failure.message = e?.code === "42501" ? "Only members of that group can read its posts." : e?.code === "P0002" ? "That category wasn't found." : "The community couldn't be loaded right now.";
      return null;
    }),
    getChurchSettings(),
  ]);
  const feedError = failure.message;
  const myGroups = groups?.mine ?? [];
  const places: ComposerPlace[] = [
    ...(categories ?? []).map((c) => ({ kind: "category" as const, id: c.id, name: c.name })),
    ...myGroups.filter((g) => g.status === "active").map((g) => ({ kind: "group" as const, id: g.id, name: g.name })),
  ];
  const canPost = !!guidelines?.acked && !guidelines.posting_restricted && places.length > 0;
  const here = category ? `/community?category=${category}` : group ? `/community?group=${group}` : "/community";
  const placeKey = category ? `category:${category}` : group && places.some((p) => p.id === group) ? `group:${group}` : null;
  const filters = [
    { href: "/community", label: "All", active: !category && !group, group: false },
    ...(categories ?? []).map((c) => ({ href: `/community?category=${c.id}`, label: c.name, active: c.id === category, group: false })),
    ...myGroups.map((g) => ({ href: `/community?group=${g.id}`, label: g.name, active: g.id === group, group: true })),
  ];

  return (
    <div className="mx-auto max-w-[40rem]">
      <h1 className="font-display text-[1.75rem] font-semibold leading-tight">Community</h1>
      <p className="mt-1 text-meta text-text-secondary">For our church family only. Group posts stay inside their group.</p>

      <nav aria-label="Filter posts" className="-mx-4 mt-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2">
          {filters.map((f) => (
            <li key={f.href}>
              <Link
                href={f.href}
                aria-current={f.active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-meta font-semibold transition-colors",
                  f.active ? "border-primary bg-primary-soft text-text" : "border-border bg-surface text-text-secondary hover:text-text",
                )}
              >
                {f.group ? <Lock className="size-3.5" aria-hidden="true" /> : null}
                {f.label}
                {f.group ? <span className="sr-only"> (private group)</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-4 space-y-4">
        {sp.deleted ? <Alert tone="success" title="Your post was deleted." /> : null}
        {posted ? <Alert tone="success" title="Your post is shared." /> : null}
        {guidelines && !guidelines.acked ? (
          <Alert tone="info" title="Before you post">
            Please read the <Link href="/community/guidelines" className="font-semibold text-primary underline">community guidelines</Link>. You can read posts now and share once
            you&apos;ve accepted them.
          </Alert>
        ) : null}
        {guidelines?.posting_restricted ? (
          <Alert tone="warning" title="Your posting is paused">
            A moderator has paused your community posting. You can still read posts. <Link href="/community/guidelines" className="font-semibold text-primary underline">Details</Link>
          </Alert>
        ) : null}

        {canPost ? <FeedComposer key={here} viewerName={viewer.preferredName || viewer.fullName} places={places} initialPlace={placeKey} returnTo={here} /> : null}

        {feed ? (
          <>
            <PinnedPosts items={feed.pinned} />
            <Feed
              key={here}
              initial={{ items: feed.items.map((p) => ({ ...p, html: p.body ? renderCommunityText(p.body) : null })), next_cursor: feed.next_cursor }}
              place={{ category, group }}
              timeZone={settings.timezone}
              postedId={posted}
            />
          </>
        ) : (
          <Alert tone="error" title={feedError ?? "The community couldn't be loaded right now."}>
            {feedError?.startsWith("Only members") ? (
              <>
                You can ask to join from <Link href="/groups" className="font-semibold text-primary underline">Groups</Link>.
              </>
            ) : (
              "Please try again in a moment."
            )}
          </Alert>
        )}

        <p className="flex items-center gap-2 pt-2 text-meta text-text-secondary">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          <span>
            <Link href="/community/guidelines" className="font-semibold text-primary underline">Community guidelines</Link> · Use Report in a post&apos;s ⋯ menu if something seems wrong.
          </span>
        </p>
      </div>
    </div>
  );
}
