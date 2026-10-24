import { ChevronLeft, ChevronRight, Search, UserPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MemberAvatar } from "@/components/profile/member-avatar";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { DIRECTORY_PAGE_SIZE, cityLine, parsePage, parseQuery } from "@/lib/directory/format";
import { searchDirectory, type DirectoryCard } from "@/lib/directory/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Directory" };

function pageHref(q: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const s = params.toString();
  return s ? `/directory?${s}` : "/directory";
}

export default async function DirectoryPage({ searchParams }: PageProps<"/directory">) {
  await requireApprovedMember("/directory");
  const params = await searchParams;
  const q = parseQuery(params.q);
  const page = parsePage(params.page);
  const supabase = await requireClient();

  let result: { members: DirectoryCard[]; total: number } | null = null;
  try {
    result = await searchDirectory(supabase, { query: q, page });
  } catch {
    result = null;
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / DIRECTORY_PAGE_SIZE)) : 1;

  return (
    <>
      <SectionHeader
        section="directory"
        description="Approved members of our church family. Only members can see this, and each person chooses what they share."
        actions={
          <ButtonLink href="/profile/edit" variant="secondary" size="sm" icon={<UserPen className="size-4" aria-hidden="true" />}>
            Edit my profile
          </ButtonLink>
        }
      />

      <form role="search" action="/directory" className="mb-6 flex gap-2">
        <label htmlFor="directory-search" className="sr-only">
          Search the directory by name or city
        </label>
        <span className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
        <input
          id="directory-search"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={80}
          placeholder="Search by name or city"
          className="min-h-12 w-full rounded-full border border-border-strong bg-surface pl-11 pr-5 transition-colors hover:border-text-secondary"
        />
        </span>
        <button type="submit" className={buttonClasses("primary")}>
          Search
        </button>
      </form>

      {!result ? (
        <Alert tone="error" title="The directory couldn't be loaded right now.">
          Please try again in a moment.
        </Alert>
      ) : !result.members.length ? (
        <EmptyState
          glyph="directory"
          title={q ? "No members match that search" : "No one is listed yet"}
          action={
            q ? (
              <ButtonLink href="/directory" variant="secondary" size="sm">
                Clear search
              </ButtonLink>
            ) : null
          }
        >
          {q ? "Try part of a first name, last name, or city." : "Members appear here after they are approved, unless they choose to stay hidden."}
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-meta text-text-secondary" role="status">
            {result.total === 1 ? "1 member" : `${result.total} members`}
            {q ? ` matching “${q}”` : ""}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {result.members.map((m) => {
              const place = cityLine(m.city, m.stateRegion);
              return (
                <li key={m.id}>
                  <Link
                    href={`/directory/${m.id}`}
                    className="interactive flex min-h-[4.5rem] items-center gap-3.5 rounded-tile border border-border bg-surface px-3.5 py-3 shadow-(--elev-card) hover:bg-surface-muted/50"
                  >
                    <MemberAvatar name={m.displayName} photoUrl={m.photoUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-title font-semibold">{m.displayName}</span>
                      {m.fullName && m.fullName !== m.displayName ? (
                        <span className="block truncate text-meta text-text-secondary">{m.fullName}</span>
                      ) : null}
                      {place ? <span className="block truncate text-meta text-text-secondary">{place}</span> : null}
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Directory pages" className="mt-6 flex items-center justify-between gap-3">
              {page > 1 ? (
                <ButtonLink href={pageHref(q, page - 1)} variant="secondary" size="sm" icon={<ChevronLeft className="size-4" aria-hidden="true" />}>
                  Previous
                </ButtonLink>
              ) : (
                <span />
              )}
              <p className="text-meta text-text-secondary">
                Page {Math.min(page, pages)} of {pages}
              </p>
              {page < pages ? (
                <ButtonLink href={pageHref(q, page + 1)} variant="secondary" size="sm">
                  Next <ChevronRight className="size-4" aria-hidden="true" />
                </ButtonLink>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
