import { BookUser, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Whether other members can find this person in the directory right now. */
export function DirectoryBadge({ status, listed }: { status: "pending" | "approved" | "suspended"; listed: boolean }) {
  if (status !== "approved") return null;
  return listed ? (
    <Badge tone="info" icon={<BookUser className="size-3.5" aria-hidden="true" />}>
      In directory
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<EyeOff className="size-3.5" aria-hidden="true" />}>
      Hidden from directory
    </Badge>
  );
}
