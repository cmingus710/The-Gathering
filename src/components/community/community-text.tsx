import { cn } from "@/components/ui/cn";
import { renderCommunityText } from "@/lib/community/format";

/** Renders a post or reply. Safe: the renderer escapes HTML and filters links. */
export function CommunityText({ source, className }: { source: string; className?: string }) {
  return <div className={cn("prose-gathering break-words", className)} dangerouslySetInnerHTML={{ __html: renderCommunityText(source) }} />;
}
