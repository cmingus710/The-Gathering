import { ArrowLeft, Home, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MemberAvatar } from "@/components/profile/member-avatar";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { parseQuery } from "@/lib/directory/format";
import { searchDirectory, type DirectoryCard } from "@/lib/directory/queries";
import { getMyHousehold, getMyHouseholdInvitations, type HouseholdSummary, type ReceivedInvitation } from "@/lib/profile/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { getChurchSettings } from "@/lib/settings/queries";
import { CreateHouseholdForm, InviteButton, LeaveHouseholdButton, RenameHouseholdForm, RespondButtons, RevokeButton } from "./household-forms";

export const metadata: Metadata = { title: "Household" };

export default async function HouseholdPage({ searchParams }: PageProps<"/profile/household">) {
  const viewer = await requireApprovedMember("/profile/household");
  const [params, supabase, { settings }] = await Promise.all([searchParams, requireClient(), getChurchSettings()]);
  const q = parseQuery(params.q);

  let household: HouseholdSummary | null = null;
  let invitations: ReceivedInvitation[] = [];
  let failed = false;
  try {
    [household, invitations] = await Promise.all([getMyHousehold(supabase), getMyHouseholdInvitations(supabase)]);
  } catch {
    failed = true;
  }

  let candidates: DirectoryCard[] = [];
  if (household && q) {
    const memberIds = new Set(household.members.map((m) => m.id));
    try {
      candidates = (await searchDirectory(supabase, { query: q, page: 1, pageSize: 10 })).members.filter((m) => !memberIds.has(m.id) && m.id !== viewer.id);
    } catch {
      candidates = [];
    }
  }
  const invited = new Set(household?.invitations.map((i) => i.invitee_id));

  return (
    <>
      <Link href="/profile" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Profile
      </Link>
      <PageHeader
        title="Household"
        description="Connect your profile with other adults you live with. Each person joins only by accepting an invitation, and being in a household never shares anything you've kept private."
      />

      {failed ? <Alert tone="error" title="Your household couldn't be loaded right now." className="mb-6" /> : null}

      {invitations.length ? (
        <section aria-labelledby="invitations-heading" className="mb-6">
          <SectionHeading id="invitations-heading">Invitations for you</SectionHeading>
          <ul className="space-y-3">
            {invitations.map((inv) => {
              const label = inv.household_name ?? `${inv.invited_by_name}'s household`;
              return (
                <li key={inv.id}>
                  <Card className="space-y-3">
                    <p>
                      <span className="font-semibold">{inv.invited_by_name}</span> invited you to join{" "}
                      <span className="font-semibold">{label}</span>.
                    </p>
                    <p className="text-[0.95rem] text-text-secondary">Open until {formatDate(inv.expires_at, settings.timezone)}.</p>
                    {household ? (
                      <p className="text-[0.95rem] text-text-secondary">To accept, leave your current household first.</p>
                    ) : null}
                    <RespondButtons invitationId={inv.id} householdLabel={label} />
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!household ? (
        !failed ? (
          <Card>
            <SectionHeading>Create a household</SectionHeading>
            <p className="mb-4 text-text-secondary">
              After creating it, you can invite adults who appear in the directory. Children are not added to households yet.
            </p>
            <CreateHouseholdForm />
          </Card>
        ) : null
      ) : (
        <div className="space-y-6">
          <Card>
            <SectionHeading>
              <span className="inline-flex items-center gap-2">
                <Home className="size-4" aria-hidden="true" /> {household.display_name ?? "Your household"}
              </span>
            </SectionHeading>
            <ul className="divide-y divide-border">
              {household.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <Users className="size-5 text-text-secondary" aria-hidden="true" />
                  {m.is_me ? (
                    <span className="font-semibold">
                      {m.display_name} <span className="font-normal text-text-secondary">(you)</span>
                    </span>
                  ) : m.listed ? (
                    <Link href={`/directory/${m.id}`} className="font-semibold text-primary hover:underline">
                      {m.display_name}
                    </Link>
                  ) : (
                    <span className="font-semibold">{m.display_name}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[0.95rem] text-text-secondary">
              Members see your household on your directory profile only if you{" "}
              <Link href="/profile/privacy" className="font-semibold text-primary underline underline-offset-2">
                share it
              </Link>
              , and only alongside adults who share theirs.
            </p>
          </Card>

          <Card>
            <SectionHeading>Invite an adult</SectionHeading>
            <p className="mb-3 text-[0.95rem] text-text-secondary">
              Search the directory for someone you live with. They&apos;ll see the invitation in the app. No email is sent, and
              invitations expire after 14 days.
            </p>
            <form role="search" action="/profile/household" className="flex gap-2">
              <label htmlFor="invite-search" className="sr-only">
                Search the directory by name
              </label>
              <input
                id="invite-search"
                name="q"
                type="search"
                defaultValue={q}
                maxLength={80}
                placeholder="Search by name"
                className="min-h-12 w-full rounded-full border border-border-strong bg-surface-muted px-5"
              />
              <button type="submit" className={buttonClasses("secondary")}>
                <Search className="size-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Search</span>
              </button>
            </form>
            {q ? (
              candidates.length ? (
                <ul className="mt-4 divide-y divide-border">
                  {candidates.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <MemberAvatar name={c.displayName} photoUrl={c.photoUrl} size="sm" />
                        <span className="truncate font-semibold">{c.displayName}</span>
                      </span>
                      {invited.has(c.id) ? (
                        <span className="text-[0.95rem] text-text-secondary">Invited</span>
                      ) : (
                        <InviteButton inviteeId={c.id} name={c.displayName} />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No one in the directory matches that name" />
              )
            ) : null}
          </Card>

          {household.invitations.length ? (
            <Card>
              <SectionHeading>Open invitations</SectionHeading>
              <ul className="divide-y divide-border">
                {household.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      <span className="font-semibold">{i.invitee_name}</span>
                      <span className="block text-[0.95rem] text-text-secondary">Open until {formatDate(i.expires_at, settings.timezone)}</span>
                    </span>
                    <RevokeButton invitationId={i.id} name={i.invitee_name} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="space-y-5">
            <RenameHouseholdForm current={household.display_name ?? ""} />
            <div className="border-t border-border pt-5">
              <LeaveHouseholdButton lastMember={household.members.length <= 1} />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
