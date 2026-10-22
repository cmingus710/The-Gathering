export default function PrayerLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading prayer…</span>
      <div className="mb-6 h-9 w-40 animate-pulse rounded-full bg-surface" aria-hidden="true" />
      <div className="mb-4 h-11 w-80 max-w-full animate-pulse rounded-full bg-surface" aria-hidden="true" />
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="space-y-2 px-5 py-4">
            <span className="block h-3 w-24 animate-pulse rounded bg-surface-muted" />
            <span className="block h-4 w-2/3 animate-pulse rounded bg-surface-muted" />
            <span className="block h-3 w-1/2 animate-pulse rounded bg-surface-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}
