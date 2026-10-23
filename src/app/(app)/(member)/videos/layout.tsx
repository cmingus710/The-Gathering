import type { ReactNode } from "react";
import { requireApprovedMember } from "@/lib/auth/viewer";

/** Adult members only (youth accounts are sent to the Youth area). Standalone videos are never public. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireApprovedMember("/videos");
  return children;
}
