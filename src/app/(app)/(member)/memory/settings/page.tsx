import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { allTimeZones } from "@/app/admin/events/series";
import { MemoryNav } from "@/components/memory/nav";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import type { PracticeSettings } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";
import { DeleteHistoryForm, SettingsForm } from "./forms";

export const metadata: Metadata = { title: "Practice settings" };

export default async function SettingsPage() {
  await requireLearner("/memory/settings");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_settings");
  const s = data as (PracticeSettings & { notifications: { in_app: boolean; email: string; push: boolean } | null }) | null;
  return (
    <>
      <PageHeader title="Practice settings" description="How practice looks and feels for you, and which reminders you'd like." />
      <MemoryNav current="settings" />
      {error || !s ? (
        <Alert tone="error" title="Settings couldn't be loaded right now." />
      ) : (
        <div className="space-y-8">
          <Card>
            <SettingsForm settings={s} timezones={allTimeZones([s.effective_timezone])} />
          </Card>
          <p className="text-meta text-text-secondary">
            Reminders arrive in the app{s.notifications?.email === "immediate" ? " and by email" : ""}
            {s.notifications?.push ? " and as push notifications" : ""}. Email and push only say a reminder is waiting, never a verse or your results.{" "}
            <Link href="/notifications/settings" className="font-semibold text-primary hover:underline">
              Change where reminders go
            </Link>
            .
          </p>
          <section aria-labelledby="your-data">
            <SectionHeading id="your-data">Your practice data</SectionHeading>
            <Card className="space-y-5">
              <div>
                <a href="/api/memory/export" className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary hover:underline">
                  <Download className="size-4" aria-hidden="true" /> Download my practice data (JSON)
                </a>
                <p className="text-meta text-text-secondary">References, results, schedule, and badges. Scripture text is included only where its license allows export.</p>
              </div>
              <DeleteHistoryForm />
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
