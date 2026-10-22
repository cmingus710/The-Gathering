import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Event logistics" };

type Logistics = {
  collect_emergency_contact: boolean;
  collect_pickup: boolean;
  collect_accommodation: boolean;
  children: Array<{ child_id: string; display_name: string; emergency_name: string | null; emergency_phone: string | null; pickup_note: string | null; accommodation_note: string | null }>;
};

/**
 * Designated event personnel only. Opening this page is recorded (who and
 * when, never the values). Nothing here goes into exports, feeds, QR codes,
 * or notifications. Pickup notes are not pickup authorization.
 */
export default async function LogisticsPage({ params }: PageProps<"/youth/lead/events/[series]/logistics">) {
  const { series } = await params;
  if (!isUuid(series)) notFound();
  await requireApprovedMember(`/youth/lead/events/${series}/logistics`);
  const { data } = await youthRead<Logistics>("youth_logistics_list", { p_series: series });
  if (!data) return <Alert tone="error" title="Logistics couldn't be loaded right now." />;
  return (
    <>
      <BackLink route="/youth/lead/events/[series]/logistics" params={{ series }} />
      <PageHeader
        title="Event logistics"
        description="For staffing this event only. Don't copy, print, or share these details. Your viewing is recorded. Pickup notes describe a family's arrangements; they don't authorize anyone to collect a child."
      />
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[40rem] text-left">
          <caption className="sr-only">Registered children and the details their guardians provided for this event</caption>
          <thead className="bg-surface-muted text-meta">
            <tr>
              <th scope="col" className="px-4 py-2">Child</th>
              {data.collect_emergency_contact ? <th scope="col" className="px-4 py-2">Emergency contact</th> : null}
              {data.collect_pickup ? <th scope="col" className="px-4 py-2">Pickup notes</th> : null}
              {data.collect_accommodation ? <th scope="col" className="px-4 py-2">Shared by family</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.children.map((c) => (
              <tr key={c.child_id}>
                <th scope="row" className="px-4 py-3 font-semibold">{c.display_name}</th>
                {data.collect_emergency_contact ? (
                  <td className="px-4 py-3">{c.emergency_name ? `${c.emergency_name}, ${c.emergency_phone ?? ""}` : <span className="text-text-secondary">Not provided</span>}</td>
                ) : null}
                {data.collect_pickup ? <td className="px-4 py-3 whitespace-pre-wrap">{c.pickup_note ?? "—"}</td> : null}
                {data.collect_accommodation ? <td className="px-4 py-3 whitespace-pre-wrap">{c.accommodation_note ?? "—"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
