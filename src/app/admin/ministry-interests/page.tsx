import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { AddInterestForm, InterestRow } from "./interest-forms";

export const metadata: Metadata = { title: "Ministry interests" };

export default async function MinistryInterestsPage() {
  await requireCapability(CAPABILITIES.membersManage, "/admin/ministry-interests");
  const supabase = await requireClient();
  const [{ data, error }, { data: chosen }] = await Promise.all([
    supabase.from("ministry_interests").select("id, label, active, sort_order").order("active", { ascending: false }).order("sort_order").order("label"),
    supabase.from("member_ministry_interests").select("interest_id"),
  ]);
  const counts = new Map<string, number>();
  for (const r of chosen ?? []) counts.set(r.interest_id, (counts.get(r.interest_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Ministry interests"
        description="The options members can choose on their profile. Archiving hides an option without removing anyone's past choice."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <SectionHeading>Options</SectionHeading>
          {error ? (
            <Alert tone="error" title="Options couldn't be loaded right now." />
          ) : !data?.length ? (
            <EmptyState title="No options yet">Add the ministries members can say they&apos;re interested in.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {data.map((i) => (
                <li key={i.id}>
                  <InterestRow id={i.id} label={i.label} sortOrder={i.sort_order} active={i.active} members={counts.get(i.id) ?? 0} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionHeading>Add an option</SectionHeading>
          <AddInterestForm />
        </Card>
      </div>
    </>
  );
}
