import type { Metadata } from "next";
import Link from "next/link";
import { allTimeZones } from "@/app/admin/events/series";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { PlanForm, type PlanOptions } from "../../plan-form";

export const metadata: Metadata = { title: "New reading plan" };

export default async function NewPlanPage() {
  await requireCapability(CAPABILITIES.readingEdit, "/admin/bible/plans/new");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_admin_plan_options");
  const options = data as PlanOptions | null;
  return (
    <>
      <p className="mb-4">
        <Link href="/admin/bible" className="font-semibold text-primary hover:underline">
          Reading plans
        </Link>
      </p>
      <PageHeader title="New reading plan" description="Start a draft. Nothing is visible to members until it's published." />
      {error || !options ? (
        <Alert tone="error" title="Plan options couldn't be loaded right now." />
      ) : !options.translations.length ? (
        <Alert tone="warning" title="No Bible translation is set up yet.">
          A Bible source manager needs to add a translation first (Admin → Bible sources).
        </Alert>
      ) : (
        <Card>
          <PlanForm plan={null} options={options} timezones={allTimeZones([options.church_timezone])} />
        </Card>
      )}
    </>
  );
}
