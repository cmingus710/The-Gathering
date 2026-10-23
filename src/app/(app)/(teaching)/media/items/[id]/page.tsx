import { notFound, redirect } from "next/navigation";
import { isUuid, itemHref } from "@/lib/media/format";
import type { ItemDetail } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

/**
 * Generic address for one piece of teaching content (used by notices for
 * kinds without a section-specific address, such as videos): sends the
 * viewer to its page when they can see it.
 */
export default async function MediaItemRedirect({ params }: PageProps<"/media/items/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_item", { p_id: id });
  if (error || !data) notFound();
  redirect(itemHref(data as ItemDetail));
}
