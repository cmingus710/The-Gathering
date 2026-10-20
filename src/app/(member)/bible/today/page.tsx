import { redirect } from "next/navigation";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";

/** Where reminders link: today's reading of the member's primary plan. */
export default async function TodayPage() {
  await requireApprovedMember("/bible/today");
  const supabase = await requireClient();
  const { data } = await supabase.rpc("bible_today");
  const t = data as { plan: { id: string }; day: { id: string } | null } | null;
  if (t?.day) redirect(`/bible/day/${t.day.id}`);
  if (t?.plan) redirect(`/bible/plans/${t.plan.id}`);
  redirect("/bible");
}
