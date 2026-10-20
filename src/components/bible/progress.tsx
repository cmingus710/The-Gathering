import { percent, progressSentence, waitingSentence } from "@/lib/bible/format";
import type { Progress } from "@/lib/bible/types";

/** Private progress: only ever shown to the reader. */
export function ProgressSummary({ progress, compact = false }: { progress: Progress; compact?: boolean }) {
  const pct = percent(progress);
  const waiting = waitingSentence(progress);
  return (
    <div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.completed}
        aria-label={`${progress.completed} of ${progress.total} readings read`}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-meta text-text-secondary">
        {progressSentence(progress)}
        {!compact && progress.remaining && !progress.finished ? ` ${progress.remaining} to go.` : null}
      </p>
      {waiting && !compact ? <p className="text-meta text-text-secondary">{waiting}</p> : null}
    </div>
  );
}
