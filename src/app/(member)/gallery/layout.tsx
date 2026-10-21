import type { ReactNode } from "react";
import { requireApprovedMember } from "@/lib/auth/viewer";

/** Adult members only (youth accounts are sent to the Youth area). */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireApprovedMember("/gallery");
  return children;
}
