import { cn } from "@/components/ui/cn";
import { renderCommunityText } from "@/lib/community/format";
import type { MentionRef } from "@/lib/community/mentions";

/**
 * Renders a post, reply, or prayer request. Safe: the renderer escapes HTML
 * and filters links. `mentions` (sent with the text) decides how each
 * @mention is shown; without it they're plain "@Name" text.
 */
export function CommunityText({ source, className, mentions }: { source: string; className?: string; mentions?: MentionRef[] | null }) {
  return <div className={cn("prose-gathering break-words", className)} dangerouslySetInnerHTML={{ __html: renderCommunityText(source, { mentions }) }} />;
}
