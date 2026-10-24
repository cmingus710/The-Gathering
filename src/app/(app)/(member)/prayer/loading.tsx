export default function PrayerLoading() {
  return (
    <div role="status" aria-live="polite" className="layout-wide">
      <span className="sr-only">Loading prayer…</span>
      <div className="mb-4 flex items-center gap-3" aria-hidden="true">
        <span className="size-11 animate-pulse rounded-control bg-surface sm:size-12" />
        <span className="h-9 w-40 animate-pulse rounded-full bg-surface" />
      </div>
      <div className="max-w-3xl space-y-4" aria-hidden="true">
        <div className="h-11 w-64 max-w-full animate-pulse rounded-control bg-surface" />
        <div className="h-11 animate-pulse rounded-control bg-surface" />
        <ul className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="space-y-2 rounded-card border border-border bg-surface px-5 py-4">
              <span className="block h-3 w-32 animate-pulse rounded bg-surface-muted" />
              <span className="block h-5 w-2/3 animate-pulse rounded bg-surface-muted" />
              <span className="block h-3 w-1/2 animate-pulse rounded bg-surface-muted" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
