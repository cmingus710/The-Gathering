import { BellOff } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Conversation } from "@/components/community/conversation";
import { ToggleForm } from "@/components/community/toggle-form";
import { BackLink } from "@/components/ui/back-link";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { ConversationPage } from "@/lib/community/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { muteAction } from "../../community/actions";
import { BlockToggle, ClearConversationButton } from "../message-forms";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: PageProps<"/messages/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/messages/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [page, { settings }] = await Promise.all([
    tryCommunityRpc<ConversationPage>("community_dm_messages", { p_conversation: id, p_limit: 40 }),
    getChurchSettings(),
  ]);
  // Only the two participants get anything back.
  if (!page) notFound();
  return (
    <>
      <BackLink route="/messages/[id]" />
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex min-w-0 items-center gap-3 font-display text-[1.625rem] font-semibold leading-tight">
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-muted text-lg ring-1 ring-border">
            {page.other_name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 break-words">{page.other_name}</span>
        </h1>
        <div className="flex flex-wrap items-start gap-2">
          <ToggleForm
            action={muteAction}
            hidden={{ type: "conversation", id, on: String(!page.muted), path: `/messages/${id}` }}
            label={page.muted ? "Muted" : "Mute"}
            pressed={page.muted}
            icon={<BellOff className="size-4" aria-hidden="true" />}
            description={page.muted ? "Unmute notifications for this conversation" : "Mute notifications for this conversation"}
          />
          <BlockToggle profileId={page.other_id} name={page.other_name} blocked={page.blocked} path={`/messages/${id}`} />
          <ClearConversationButton conversationId={id} />
        </div>
      </header>
      <Conversation key={id} initial={page} timezone={settings.timezone} />
    </>
  );
}
