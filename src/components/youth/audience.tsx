import { Eye } from "lucide-react";
import type { Audience } from "@/lib/youth/types";

/** Who can see a group discussion, in plain words (never "private"). */
export function AudienceNote({ audience }: { audience: Audience }) {
  const who = [
    audience.leaders.length ? `the group's leaders (${audience.leaders.join(", ")})` : "the group's leaders",
    "youth in this group",
    audience.guardians_can_read ? "verified parents and guardians of youth in this group" : null,
    "safeguarding reviewers when something is reported",
  ].filter(Boolean);
  return (
    <p className="flex gap-2 text-meta text-text-secondary">
      <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <strong className="text-text">Who can see this:</strong> {who.join(", ")}. Nothing here is private, and there are no private messages in the Youth area.
      </span>
    </p>
  );
}
