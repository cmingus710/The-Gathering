import { notFound, redirect } from "next/navigation";
import { requireApprovedMember } from "@/lib/auth/viewer";

const UUID = /^[0-9a-f-]{36}$/;

/** Category pages are now a filter on the Community feed; old links land there. */
export default async function CategoryPage({ params }: PageProps<"/community/c/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/community/c/${id}`);
  if (!UUID.test(id)) notFound();
  redirect(`/community?category=${id}`);
}
