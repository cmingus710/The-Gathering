import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { exactTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { LogRow } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Sensitive-access log" };

const ACTION: Record<string, string> = {
  identity_lookup: "Looked up an anonymous author",
  team_request_viewed: "Opened a confidential prayer request",
  care_request_viewed: "Opened a care request",
  report_viewed: "Opened a prayer report",
};

/** For prayer and care leads: who opened or looked up what (never content). */
export default async function PrayerAccessLogPage() {
  await requireCapability(CAPABILITIES.prayerIdentity, "/admin/prayer/access");
  const [rows, { settings }] = await Promise.all([tryCommunityRpc<LogRow[]>("prayer_access_log", { p_limit: 200 }), getChurchSettings()]);
  return (
    <>
      <PageHeader title="Sensitive-access log" description="Identity lookups (with their reasons) and openings of confidential requests, care requests, and reports. Repeated openings within an hour are recorded once." />
      {!rows ? (
        <Alert tone="error" title="The log couldn't be loaded." />
      ) : (
        <ul className="space-y-1 text-meta">
          {rows.map((l, i) => (
            <li key={i}>
              {exactTime(l.at, settings.timezone)} · {l.actor} · {ACTION[l.action] ?? l.action}
              {l.reason ? ` · “${l.reason}”` : ""}
            </li>
          ))}
          {rows.length ? null : <li className="text-text-secondary">Nothing recorded yet.</li>}
        </ul>
      )}
    </>
  );
}
