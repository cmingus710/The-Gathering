import { Check, CircleAlert, Lightbulb, Minus, Plus, Sparkles } from "lucide-react";
import { StageBadge } from "@/components/memory/stage-badge";
import { changeExplanation, confidenceLabel, percent, QUALITY } from "@/lib/memory/format";
import type { SubmitResult, TypedOp } from "@/lib/memory/types";

/**
 * What a saved practice activity recorded, as separate facts: completed,
 * accuracy (scored activities only), hints, the member's own confidence,
 * and what happened to the review schedule. Correct and incorrect marks
 * always pair an icon and words with colour.
 */
export function ResultDetails({ result, today, kids }: { result: SubmitResult; today: string; kids: boolean }) {
  const d = result.details;
  return (
    <div className="space-y-5">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact term="Activity">
          <Check className="mr-1 inline size-4 text-success" aria-hidden="true" />
          Completed
        </Fact>
        <Fact term="Result">{QUALITY[result.quality]}</Fact>
        {result.accuracy !== null ? (
          <Fact term="Accuracy">
            {percent(result.accuracy)}
            {d.ops ? <span className="text-text-secondary"> ({d.matched} of {d.expected} words matched{d.extra ? `, ${d.extra} not in the verse` : ""})</span> : null}
            {d.results ? <span className="text-text-secondary"> ({d.results.filter((r) => r.correct).length} of {d.results.length} blanks)</span> : null}
            {d.chips ? <span className="text-text-secondary"> ({d.correct} of {d.chips} pieces in place)</span> : null}
          </Fact>
        ) : (
          <Fact term="Accuracy">Not scored for this activity</Fact>
        )}
        <Fact term="Hints used">{result.hints}</Fact>
        <Fact term="Your confidence">{confidenceLabel(result.confidence) ?? "Not given"}</Fact>
        <Fact term="Review">
          <span className="mr-2 inline-block align-middle">
            <StageBadge stage={result.review.stage} />
          </span>
          {changeExplanation(result.review.change, result.review.due_on, today)}
        </Fact>
      </dl>
      {result.daily_goal ? (
        <p className="text-meta text-text-secondary">
          Today: {result.done_today} of {result.daily_goal} practice activities{result.done_today >= result.daily_goal ? " · goal reached" : ""}.
        </p>
      ) : null}
      {result.badges.length ? <Badges badges={result.badges} celebrate={result.celebrations} kids={kids} /> : null}
      {d.ops ? <TypedFeedback ops={d.ops} yours={d.your_text ?? ""} text={d.text ?? ""} reference={!!d.reference_detected} numbers={d.verse_numbers_ignored ?? 0} /> : null}
      {d.results ? (
        <section aria-labelledby="blank-results">
          <h3 id="blank-results" className="mb-2 font-semibold">
            Blanks
          </h3>
          <ul className="space-y-1.5">
            {d.results.map((r) => (
              <li key={r.blank} className="flex items-start gap-2">
                {r.correct ? <Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" /> : <CircleAlert className="mt-1 size-4 shrink-0 text-danger" aria-hidden="true" />}
                <span>
                  Blank {r.blank}: {r.correct ? "right" : "not quite"} · your answer “{r.answer || "(blank)"}”{r.correct ? "" : `; the verse says “${r.expected}”`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.recall === false && result.quality !== "none" ? (
        <p className="text-meta text-text-secondary">
          This is a learning activity: it helps you get to know the verse. Typing, self-check, flashcards, and the Challenge versions move it along your review schedule.
        </p>
      ) : null}
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-meta font-semibold text-text-secondary">{term}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function Badges({ badges, celebrate, kids }: { badges: SubmitResult["badges"]; celebrate: boolean; kids: boolean }) {
  return (
    <section aria-labelledby="new-badges" className={`rounded-card border border-primary/50 bg-primary-soft/40 p-4 ${celebrate ? "memory-celebrate" : ""}`}>
      <h3 id="new-badges" className="flex items-center gap-2 font-semibold">
        <Sparkles className="size-5 text-primary" aria-hidden="true" />
        {kids && celebrate ? "Wonderful! You earned a badge" : badges.length === 1 ? "New badge" : "New badges"}
      </h3>
      <ul className="mt-2 space-y-1">
        {badges.map((b) => (
          <li key={b.key + (b.collection ?? "")}>
            <span className="font-semibold">{b.name}</span> · {b.description}
            {b.collection ? ` (${b.collection})` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Word-by-word comparison. The member's own text is shown unchanged first;
 * below it, the verse with each difference marked by an icon, a label for
 * screen readers, and a style (never colour alone).
 */
function TypedFeedback({ ops, yours, text, reference, numbers }: { ops: TypedOp[]; yours: string; text: string; reference: boolean; numbers: number }) {
  const issues = ops.filter((o) => o.op !== "match" || !o.exact).length;
  return (
    <section aria-labelledby="typed-feedback" className="space-y-4">
      <h3 id="typed-feedback" className="font-semibold">
        Word by word
      </h3>
      <div>
        <p className="mb-1 text-meta font-semibold text-text-secondary">What you typed</p>
        <p className="memory-text rounded-tile border border-border bg-surface-muted/50 p-3">{yours}</p>
      </div>
      <div>
        <p className="mb-1 text-meta font-semibold text-text-secondary">Compared with the verse</p>
        <p className="memory-text rounded-tile border border-border bg-surface p-3">
          {ops.map((o, n) => (
            <OpView key={n} op={o} />
          ))}
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-text-secondary">
          <li>
            <Minus className="mr-1 inline size-3.5" aria-hidden="true" />
            <span className="underline decoration-dotted">dotted</span>: missing
          </li>
          <li>
            <Plus className="mr-1 inline size-3.5" aria-hidden="true" />
            <s>struck</s>: not in the verse
          </li>
          <li>
            <Lightbulb className="mr-1 inline size-3.5" aria-hidden="true" />
            <span className="font-bold">bold</span>: what the verse says instead
          </li>
        </ul>
      </div>
      {!issues ? <p className="font-semibold">Every word matches.</p> : null}
      {reference || numbers ? (
        <p className="text-meta text-text-secondary">
          {reference ? "The reference you typed was recognized and set aside. " : ""}
          {numbers ? `${numbers} verse number${numbers === 1 ? " was" : "s were"} set aside. ` : ""}
          Only the words of the verse are compared.
        </p>
      ) : null}
      <div>
        <p className="mb-1 text-meta font-semibold text-text-secondary">The verse</p>
        <p className="memory-text">{text}</p>
      </div>
    </section>
  );
}

function OpView({ op }: { op: TypedOp }) {
  switch (op.op) {
    case "match":
      return <span title={op.exact ? undefined : `You typed “${op.typed}”`}>{op.expected} </span>;
    case "missing":
      return (
        <>
          <span className="underline decoration-dotted decoration-2 underline-offset-4">
            <span className="sr-only">(missing: </span>
            {op.expected}
            <span className="sr-only">)</span>
          </span>{" "}
        </>
      );
    case "extra":
      return (
        <>
          <s className="text-text-secondary">
            <span className="sr-only">(you added: </span>
            {op.typed}
            <span className="sr-only">)</span>
          </s>{" "}
        </>
      );
    case "changed":
      return (
        <>
          <s className="text-text-secondary">
            <span className="sr-only">(you typed: </span>
            {op.typed}
            <span className="sr-only">,</span>
          </s>{" "}
          <span className="font-bold">
            <span className="sr-only">the verse says: </span>
            {op.expected}
            <span className="sr-only">)</span>
          </span>{" "}
        </>
      );
  }
}
