import { Badge } from "@/components/ui/badge";

/** Gift state as a member sees it (refunds are shown, never hidden). */
export function GiftStatusBadge({ status, refunded, amount }: { status: string; refunded: number; amount: number }) {
  if (status === "succeeded" && refunded >= amount) return <Badge tone="neutral">Refunded</Badge>;
  if (status === "succeeded" && refunded > 0) return <Badge tone="warning">Partly refunded</Badge>;
  if (status === "succeeded") return <Badge tone="success">Received</Badge>;
  if (status === "pending") return <Badge tone="warning">Processing</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  return <Badge>{status}</Badge>;
}

