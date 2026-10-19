export default function DirectoryLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading the directory…</span>
      <div className="mb-6 h-9 w-44 animate-pulse rounded-full bg-surface" aria-hidden="true" />
      <div className="mb-6 h-12 w-full animate-pulse rounded-full bg-surface" aria-hidden="true" />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex min-h-20 items-center gap-4 rounded-card bg-surface p-4">
            <span className="size-12 animate-pulse rounded-full bg-surface-muted" />
            <span className="h-4 w-1/2 animate-pulse rounded bg-surface-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}
