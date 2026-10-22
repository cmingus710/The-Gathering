import { Archive, ArchiveRestore, Unlink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JournalEditor } from "@/components/journal/editor";
import { LinkContext, type EntryLink } from "@/components/journal/link-context";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { requireLearner } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { deleteEntryAction, entryStatusAction, unlinkEntryAction } from "../actions";

// Generic: the entry's title never appears in the tab, history, or logs.
export const metadata: Metadata = { title: "Journal entry" };

type Entry = { id: string; title: string; body: string; status: "active" | "archived"; version: number; created_at: string; updated_at: string; link: EntryLink | null };

export default async function EntryPage({ params }: PageProps<"/journal/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireLearner(`/journal/${id}`);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("journal_entry", { p_id: id });
  if (error?.code === "P0002") notFound();
  if (error || !data) return <Alert tone="error" title="This entry couldn't be loaded right now. Nothing was changed." />;
  const e = data as Entry;

  return (
    <>
      <div className="-mt-1 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:mb-4">
        <BackLink route="/journal/[id]" inRow />
        {e.status === "archived" ? <Badge>Archived</Badge> : null}
      </div>
      <h1 className="sr-only">Journal entry</h1>
      <LinkContext link={e.link} />
      <JournalEditor key={e.id} entry={{ id: e.id, title: e.title, body: e.body, version: e.version, updated_at: e.updated_at }} />
      <p className="mt-4 text-meta text-text-secondary">
        Written {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(e.created_at))}. Only you can see this entry.
      </p>
      <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
        <form action={entryStatusAction}>
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="action" value={e.status === "archived" ? "restore" : "archive"} />
          <Button type="submit" size="sm" variant="secondary" icon={e.status === "archived" ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}>
            {e.status === "archived" ? "Restore" : "Archive"}
          </Button>
        </form>
        {e.link ? (
          <form action={unlinkEntryAction}>
            <input type="hidden" name="id" value={e.id} />
            <Button type="submit" size="sm" variant="ghost" icon={<Unlink className="size-4" aria-hidden="true" />}>
              Remove link
            </Button>
          </form>
        ) : null}
        <ConfirmDialog trigger="Delete" title="Delete this entry?" confirmLabel="Delete entry" formAction={deleteEntryAction} hidden={{ id: e.id }}>
          This permanently deletes the entry. It can&apos;t be undone.
        </ConfirmDialog>
      </div>
    </>
  );
}
