import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { PermissionFields } from "@/components/youth/permission-fields";
import { YouthForm } from "@/components/youth/youth-form";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { RELATIONSHIPS, VERIFICATION_METHODS, formatDay } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Families and guardians" };

type Request = {
  id: string;
  kind: "new_child" | "existing_child";
  child_name: string;
  details: string;
  relationship: string;
  birth_date_provided: boolean;
  status: string;
  created_at: string;
  requester: { id: string; name: string; approved: boolean };
};
type ChildRow = { id: string; display_name: string; status: string; restricted: boolean; account_linked: boolean; guardians: number; paused_guardians: number; groups: string[] };

export default async function FamiliesPage({ searchParams }: PageProps<"/admin/youth/families">) {
  const viewer = await requireCapability(CAPABILITIES.familyVerify, "/admin/youth/families");
  const q = String((await searchParams).q ?? "").slice(0, 60);
  const [requests, children] = await Promise.all([
    youthRead<Request[]>("youth_admin_requests", { p_status: "pending" }),
    youthRead<ChildRow[]>("youth_admin_children", { p_query: q || null }),
  ]);
  const matches = await Promise.all(
    (requests.data ?? []).map((r) => (r.kind === "existing_child" ? youthRead<ChildRow[]>("youth_admin_children", { p_query: r.child_name }).then((x) => x.data ?? []) : Promise.resolve([]))),
  );
  return (
    <>
      <PageHeader
        title="Families and guardians"
        description="Verify each relationship yourself (in person or from church records). Nothing is matched automatically from names, households, addresses, or email. You can't review your own request."
      />
      <div className="space-y-10">
        <section aria-labelledby="requests">
          <SectionHeading id="requests">Requests waiting ({requests.data?.length ?? 0})</SectionHeading>
          {requests.failed ? <Alert tone="error" title="Requests couldn't be loaded right now." /> : null}
          {(requests.data ?? []).length === 0 ? (
            <EmptyState glyph="youth" title="No requests waiting" />
          ) : (
            <ul className="space-y-4">
              {(requests.data ?? []).map((r, i) => (
                <li key={r.id}>
                  <Card className="space-y-4">
                    <div>
                      <h3 className="text-[1.125rem] font-semibold">
                        {r.requester.name} → {r.child_name}
                      </h3>
                      <p className="text-meta text-text-secondary">
                        {RELATIONSHIPS[r.relationship]} · {r.kind === "new_child" ? "new child profile" : "a child who may already be on record"} · {formatDay(r.created_at)}
                        {r.birth_date_provided ? " · date of birth provided" : ""}
                      </p>
                      {r.details ? <p className="mt-2 whitespace-pre-wrap">{r.details}</p> : null}
                      {!r.requester.approved ? <Badge tone="danger">Requester&apos;s membership isn&apos;t active</Badge> : null}
                    </div>
                    {r.requester.id === viewer.id ? (
                      <Alert tone="info" title="This is your own request. Another family administrator must review it." />
                    ) : (
                      <>
                        <YouthForm op="request_decide" hidden={{ id: r.id, decision: "approve" }} submit="Verify and link" pendingText="Saving…">
                          <SelectField id={`child-${r.id}`} label="Child profile" name="child_id" defaultValue="">
                            <option value="">Create a new child profile</option>
                            {matches[i].map((c) => (
                              <option key={c.id} value={c.id}>
                                Existing: {c.display_name} ({c.guardians} verified guardian{c.guardians === 1 ? "" : "s"})
                              </option>
                            ))}
                          </SelectField>
                          <TextField id={`name-${r.id}`} label="Preferred name for a new profile" name="display_name" defaultValue={r.child_name} maxLength={60} />
                          <SelectField id={`method-${r.id}`} label="How did you verify the relationship?" name="verification_method" defaultValue="">
                            <option value="" disabled>
                              Choose…
                            </option>
                            {Object.entries(VERIFICATION_METHODS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </SelectField>
                          <p className="text-meta text-text-secondary">Don&apos;t upload or record identity documents or custody papers here.</p>
                          <PermissionFields idPrefix={`req-${r.id}`} />
                        </YouthForm>
                        <YouthForm op="request_decide" hidden={{ id: r.id, decision: "decline" }} submit="Decline" variant="secondary" size="sm" inline />
                      </>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="children">
          <SectionHeading id="children">Child profiles</SectionHeading>
          <form role="search" className="mb-3 flex flex-wrap items-end gap-2">
            <TextField label="Search by preferred name" name="q" defaultValue={q} className="min-w-64 flex-1" />
            <button type="submit" className="min-h-12 rounded-full border border-border px-5 font-semibold">
              Search
            </button>
          </form>
          <div className={rowListClass}>
            {(children.data ?? []).map((c) => (
              <ListRow
                key={c.id}
                plain
                href={`/admin/youth/families/children/${c.id}`}
                label={c.display_name}
                description={`${c.guardians} verified guardian${c.guardians === 1 ? "" : "s"}${c.groups.length ? ` · ${c.groups.join(", ")}` : ""}`}
                trailing={
                  c.restricted ? (
                    <Badge tone="danger">Restricted</Badge>
                  ) : c.status !== "active" ? (
                    <Badge tone="neutral">{c.status === "transitioned" ? "Adult access" : "Archived"}</Badge>
                  ) : c.account_linked ? (
                    <Badge tone="info">Own account</Badge>
                  ) : undefined
                }
              />
            ))}
          </div>
          <Card className="mt-4">
            <h3 className="mb-3 font-semibold">Create a child profile</h3>
            <YouthForm op="admin_child_save" submit="Create" hidden={{ participation: "active" }}>
              <TextField label="Preferred name" name="display_name" maxLength={60} required />
            </YouthForm>
            <p className="mt-2 text-meta text-text-secondary">
              A child profile isn&apos;t a login. Guardians are linked only through a verified request.{" "}
              <Link href="/admin/youth" className="font-semibold text-primary hover:underline">
                Back to Youth & families
              </Link>
            </p>
          </Card>
        </section>
      </div>
    </>
  );
}
