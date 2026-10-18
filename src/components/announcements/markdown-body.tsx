import { renderAnnouncementMarkdown } from "@/lib/announcements/markdown";
import { cn } from "@/components/ui/cn";

/** Renders announcement Markdown. Safe: the renderer escapes HTML and filters links. */
export function MarkdownBody({ source, className }: { source: string; className?: string }) {
  return <div className={cn("prose-gathering", className)} dangerouslySetInnerHTML={{ __html: renderAnnouncementMarkdown(source) }} />;
}
