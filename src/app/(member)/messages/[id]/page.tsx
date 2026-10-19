import { ArrowLeft, BellOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Conversation } from "@/components/community/conversation";
import { ToggleForm } from "@/components/community/toggle-form";
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
      <Link href="/messages" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Messages
      </Link>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.6rem] font-bold leading-tight">{page.other_name}</h1>
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
