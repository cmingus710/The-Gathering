import { ChevronRight, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge, MembershipBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { isApplePrivateRelay } from "@/lib/auth/oauth";
import { requireCapability } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { DirectoryBadge } from "./directory-badge";
import { StatusControls } from "./member-controls";

export const metadata: Metadata = { title: "Members" };

const FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "suspended", label: "Suspended" },
  { key: "all", label: "All" },
] as const;

type Row = {
  id: string;
  email: string;
  full_name: string;
  preferred_name: string | null;
  membership_status: "pending" | "approved" | "suspended";
  account_kind: "adult" | "youth";
  created_at: string;
  user_roles: Array<{ role_key: string; roles: { name: string } | null }>;
  member_profile_details?: { directory_listed: boolean } | null;
};

export default async function MembersPage({ searchParams }: PageProps<"/admin/members">) {
  const viewer = await requireCapability(CAPABILITIES.membersView, "/admin/members");
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === params.status)?.key ?? "pending";
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const supabase = await requireClient();
  const { settings } = await getChurchSettings();

  const canManage = viewer.capabilities.has(CAPABILITIES.membersManage);
  // Directory visibility is part of the private details, readable only with members.manage.
  const columns =
    "id, email, full_name, preferred_name, membership_status, account_kind, created_at, user_roles!user_roles_user_id_fkey(role_key, roles(name))" +
    (canManage ? ", member_profile_details(directory_listed)" : "");
  let query = supabase
    .from("profiles")
    .select(columns)
    .order("created_at", { ascending: filter === "pending" })
    .limit(200);
  if (filter !== "all") query = query.eq("membership_status", filter);
  if (q) {
    const term = q.replace(/[%_,()"\\]/g, " ");
    query = query.or(`full_name.ilike."%${term}%",preferred_name.ilike."%${term}%",email.ilike."%${term}%"`);
  }
  const { data, error } = await query.returns<Row[]>();

  return (
    <>
      <PageHeader title="Members" description="Review registrations, manage member access, and correct profile details. Everyone is listed here, including members hidden from the directory." />
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <nav aria-label="Filter members by status" className="-mx-1 overflow-x-auto px-1">
          <ul className="flex gap-1.5">
            {FILTERS.map((f) => (
              <li key={f.key}>
                <Link
                  href={`/admin/members?status=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                  aria-current={filter === f.key ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center rounded-full border px-4 font-semibold",
                    filter === f.key ? "border-text bg-text text-background" : "border-border-strong bg-surface hover:bg-surface-muted",
                  )}
                >
                  {f.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <form role="search" className="flex gap-2" action="/admin/members">
          <input type="hidden" name="status" value={filter} />
          <label htmlFor="member-search" className="sr-only">
            Search members by name or email
          </label>
          <input
            id="member-search"
            name="q"
            defaultValue={q}
            placeholder="Name or email"
            className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 sm:w-56"
          />
          <button type="submit" className={buttonClasses("secondary", "sm")}>
            <Search className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Search</span>
          </button>
        </form>
      </div>

      {error ? (
        <Alert tone="error" title="Members couldn't be loaded right now." />
      ) : !data?.length ? (
        <EmptyState icon={<Users className="size-5" aria-hidden="true" />} title={q ? "No members match that search" : "No members in this list"}>
          {filter === "pending" && !q
            ? "New registrations appear here after people verify their email or sign in with Google or Apple."
            : null}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.map((m) => {
            const name = m.preferred_name || m.full_name || m.email;
            const isSelf = m.id === viewer.id;
            return (
              <li key={m.id} className="rounded-card border border-border bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/members/${m.id}`} className="group inline-flex items-center gap-1 font-semibold hover:underline">
                      {name}
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </Link>
                    <p className="break-all text-meta text-text-secondary">{m.email}</p>
                    {isApplePrivateRelay(m.email) ? (
                      <p className="text-sm text-text-secondary">Apple private relay address: it doesn&apos;t identify the person.</p>
                    ) : null}
                    <p className="text-sm text-text-secondary">Registered {formatDate(m.created_at, settings.timezone)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <MembershipBadge status={m.membership_status} />
                    {m.account_kind === "youth" ? <Badge tone="info">Youth account (managed under Youth &amp; families)</Badge> : null}
                    {m.user_roles.map((r) => (
                      <Badge key={r.role_key}>{r.roles?.name ?? r.role_key}</Badge>
                    ))}
                    {canManage ? <DirectoryBadge status={m.membership_status} listed={m.member_profile_details?.directory_listed ?? true} /> : null}
                  </div>
                </div>
                {canManage && !isSelf ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <StatusControls userId={m.id} status={m.membership_status} name={name} compact />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
