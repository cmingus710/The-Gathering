import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MemoryNav } from "@/components/memory/nav";
import { PassageText } from "@/components/memory/passage";
import { StageBadge } from "@/components/memory/stage-badge";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireLearner } from "@/lib/auth/viewer";
import { ACTIVITIES, STAGES, activityLabel, confidenceLabel, difficultyLabel, formatDay, percent, QUALITY, reviewDate } from "@/lib/memory/format";
import type { CardDetail, Collection } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";
import { myCollectionItemAction, removeVerseAction, switchVersionAction } from "../../actions";

export const metadata: Metadata = { title: "Memory verse" };

export default async function VersePage({ params, searchParams }: PageProps<"/memory/verses/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireLearner(`/memory/verses/${id}`);
  const supabase = await requireClient();
  const [{ data, error }, cols, today] = await Promise.all([
    supabase.rpc("memory_card", { p_id: id }),
    supabase.rpc("memory_collections"),
    supabase.rpc("memory_review_queue"),
  ]);
  if (error?.code === "P0002" || (error && /invalid input syntax/.test(error.message))) notFound();
  const c = data as CardDetail | null;
  if (!c) return <Alert tone="error" title="This verse couldn't be loaded right now." />;
  const todayYmd = (today.data as { today: string } | null)?.today;
  const mine = ((cols.data as { personal: Collection[] } | null)?.personal ?? []).filter((x) => x.translation.id === c.passage.translation.id);
  const active = c.status === "active";

  return (
    <>
      <PageHeader
        eyebrow={c.item?.collection.title ?? "Added by you"}
        title={
          <>
            {c.passage.label} <span className="text-text-secondary">({c.passage.translation.code})</span>
          </>
        }
        description={c.item?.title ?? undefined}
      />
      <MemoryNav current="verses" />
      {sp.updated ? <Alert tone="success" title="You're now practicing the updated text. Your earlier practice is kept with the earlier text." className="mb-6" /> : null}
      {sp.translation ? (
        <Alert tone="success" title={`You're now practicing this verse in ${c.passage.translation.name} (${c.passage.translation.code}).`} className="mb-6">
          Your practice in the earlier version is kept with that text. Your default and your other verses didn&apos;t change.
        </Alert>
      ) : null}
      {c.update_available ? (
        <Alert tone="warning" title="This verse's text has been updated." className="mb-6">
          <p>
            {c.update_available.source === "collection"
              ? c.update_available.reason ?? "The church updated the text of this verse."
              : "The Bible source's text for this passage changed after you added it."}{" "}
            Practice of one wording isn&apos;t practice of another, so switching starts this verse fresh. Your earlier results stay with the earlier text.
          </p>
          <form action={switchVersionAction} className="mt-2">
            <input type="hidden" name="id" value={c.id} />
            <SubmitButton size="sm" pendingText="Switching…">
              Practice the updated text
            </SubmitButton>
          </form>
        </Alert>
      ) : null}
      {!c.translation_available ? <Alert tone="info" title={`${c.passage.translation.code} is no longer offered, so this verse can't be practiced. Its history is kept.`} className="mb-6" /> : null}
      {c.status === "superseded" ? <Alert tone="info" title="This is an earlier text of the verse. Its history is kept here; practice continues with the updated text or another version." className="mb-6" /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <PassageText passage={c.passage} />
          </Card>
          {c.item?.note || c.item?.hint ? (
            <aside aria-label="From the church" className="rounded-card border border-border bg-surface-muted/50 p-4 text-meta">
              {c.item.note ? <p className="whitespace-pre-line">{c.item.note}</p> : null}
              {c.item.hint ? (
                <p className="mt-2">
                  <span className="font-semibold">Hint:</span> {c.item.hint}
                </p>
              ) : null}
            </aside>
          ) : null}
          {active && c.translation_available ? (
            <section aria-labelledby="practice">
              <SectionHeading id="practice">Practice</SectionHeading>
              <ul className="grid gap-2 sm:grid-cols-2">
                {ACTIVITIES.map((a) => (
                  <li key={a.key}>
                    <Link href={`/memory/practice/${c.id}?activity=${a.key}`} className="interactive block min-h-14 rounded-tile border border-border bg-surface p-3 hover:bg-surface-muted/60">
                      <span className="block font-semibold">{a.label}</span>
                      <span className="block text-meta text-text-secondary">{c.settings.presentation === "kids" ? a.kids : a.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="space-y-6">
          <section aria-labelledby="schedule" className="rounded-card border border-border bg-surface p-4">
            <SectionHeading id="schedule" as="h2">
              Your review schedule
            </SectionHeading>
            <p className="flex flex-wrap items-center gap-2">
              <StageBadge stage={c.stage} /> <span className="text-meta text-text-secondary">{STAGES[c.stage].description}</span>
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-meta">
              <div>
                <dt className="text-text-secondary">Next review</dt>
                <dd className="font-semibold">{c.due ? "Today" : c.due_on ? reviewDate(c.due_on, todayYmd).replace(/^on /, "") : "Today"}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Practice activities</dt>
                <dd className="font-semibold">{c.sessions}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Review-ready</dt>
                <dd className="font-semibold">{c.review_ready ? "Yes" : "Not yet"}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Added</dt>
                <dd className="font-semibold">{formatDay(c.added_at.slice(0, 10))}</dd>
              </div>
            </dl>
            <p className="mt-3 text-meta text-text-secondary">Only you can see this.</p>
          </section>

          <section aria-labelledby="version" className="rounded-card border border-border bg-surface p-4">
            <SectionHeading id="version" as="h2">
              Bible version
            </SectionHeading>
            <p className="font-semibold">
              {c.passage.translation.name} ({c.passage.translation.code})
            </p>
            <p className="mt-1 text-meta text-text-secondary">
              {c.assignment && !c.assignment.choice
                ? `Assigned in ${c.assignment.translation.code}: this assignment is practiced in that version.`
                : c.assignment?.own_translation
                  ? `Assigned in ${c.assignment.translation.code}; you chose ${c.passage.translation.code} for yourself. The assignment is unchanged for everyone else.`
                  : c.assignment?.choice
                    ? `Assigned in ${c.assignment.translation.code}. You may practice it in another version.`
                    : "Practice and checking always use exactly this wording."}
            </p>
            {active && c.can_change_translation ? (
              <ButtonLink href={`/memory/verses/${c.id}/translation`} size="sm" variant="secondary" className="mt-3">
                Change translation
              </ButtonLink>
            ) : null}
          </section>

          {active && mine.length ? (
            <section aria-labelledby="add-to" className="rounded-card border border-border bg-surface p-4">
              <SectionHeading id="add-to" as="h2">
                Add to my collection
              </SectionHeading>
              <ul className="space-y-2">
                {mine.map((m) => (
                  <li key={m.id}>
                    <form action={myCollectionItemAction}>
                      <input type="hidden" name="collection_id" value={m.id} />
                      <input type="hidden" name="card_id" value={c.id} />
                      <SubmitButton size="sm" variant="secondary" pendingText="Adding…">
                        {m.title}
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {c.earlier.length ? (
            <section aria-labelledby="earlier" className="rounded-card border border-border bg-surface p-4">
              <SectionHeading id="earlier" as="h2">
                Other texts and versions of this verse
              </SectionHeading>
              <ul className="space-y-1 text-meta">
                {c.earlier.map((e) => (
                  <li key={e.id}>
                    <Link href={`/memory/verses/${e.id}`} className="font-semibold text-primary hover:underline">
                      {e.translation} · text version {e.version}
                    </Link>{" "}
                    · {e.sessions} practice {e.sessions === 1 ? "activity" : "activities"} · {e.status === "active" ? "current" : e.status === "superseded" ? "earlier" : "removed"}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="manage" className="space-y-3 rounded-card border border-border bg-surface p-4">
            <SectionHeading id="manage" as="h2">
              Remove or delete
            </SectionHeading>
            {c.status === "removed" ? (
              <form action={removeVerseAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="mode" value="restore" />
                <SubmitButton size="sm" variant="secondary">
                  Restore to My Verses
                </SubmitButton>
              </form>
            ) : active ? (
              <form action={removeVerseAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="mode" value="remove" />
                <SubmitButton size="sm" variant="secondary">
                  Remove from My Verses (keep history)
                </SubmitButton>
              </form>
            ) : null}
            <ConfirmDialog trigger="Delete this verse and its history" title="Delete this verse and its practice history?" confirmLabel="Delete permanently" formAction={removeVerseAction} hidden={{ id: c.id, mode: "delete" }}>
              <p>Your results, schedule, and history for this verse will be deleted and can&apos;t be recovered. The verse stays in the Bible and in any church collection. Badges you&apos;ve already earned stay.</p>
            </ConfirmDialog>
          </section>
        </div>
      </div>

      <section aria-labelledby="history" className="mt-8">
        <SectionHeading id="history" description="Each entry keeps its own facts; a single good day isn't counted as permanent mastery.">
          Your practice history
        </SectionHeading>
        {c.history.length ? (
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full min-w-[46rem] text-left text-meta">
              <caption className="sr-only">Practice history for {c.passage.label}</caption>
              <thead className="border-b border-border text-text-secondary">
                <tr>
                  <th scope="col" className="px-3 py-2">Date</th>
                  <th scope="col" className="px-3 py-2">Activity</th>
                  <th scope="col" className="px-3 py-2">Version</th>
                  <th scope="col" className="px-3 py-2">Result</th>
                  <th scope="col" className="px-3 py-2">Accuracy</th>
                  <th scope="col" className="px-3 py-2">Hints</th>
                  <th scope="col" className="px-3 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {c.history.map((h) => (
                  <tr key={h.at}>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDay(h.date)}</td>
                    <td className="px-3 py-2">
                      {activityLabel(h.activity)} <span className="text-text-secondary">· {difficultyLabel(h.difficulty)}{h.segment ? ` · part ${h.segment}` : ""}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {h.translation}
                      {h.text_version > 1 ? <span className="text-text-secondary"> · text {h.text_version}</span> : null}
                    </td>
                    <td className="px-3 py-2">{QUALITY[h.quality]}</td>
                    <td className="px-3 py-2">{percent(h.accuracy) ?? "—"}</td>
                    <td className="px-3 py-2">{h.hints}</td>
                    <td className="px-3 py-2">{confidenceLabel(h.confidence) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-text-secondary">No practice yet.</p>
        )}
      </section>
      {active && c.translation_available ? (
        <div className="mt-6">
          <ButtonLink href={`/memory/practice/${c.id}`}>Practice now</ButtonLink>
        </div>
      ) : null}
    </>
  );
}
