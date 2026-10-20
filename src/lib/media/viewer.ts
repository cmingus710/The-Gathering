import "server-only";
import { getViewer } from "@/lib/auth/viewer";

/** Who is looking at a public-capable teaching page. */
export async function teachingViewer(): Promise<{ member: boolean; signedIn: boolean; canEdit: boolean }> {
  const result = await getViewer();
  if (result.state !== "signed-in") return { member: false, signedIn: false, canEdit: false };
  const member = result.viewer.status === "approved";
  return {
    member,
    signedIn: true,
    canEdit: member && (result.viewer.capabilities.has("content.edit") || result.viewer.capabilities.has("content.publish")),
  };
}
