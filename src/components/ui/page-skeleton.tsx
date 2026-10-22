/**
 * Placeholder shown inside the app shell while a page loads (route
 * loading.tsx files): a title bar and a few card outlines, so a tap gets
 * immediate feedback without a blank screen. It holds no member data.
 */
export function PageSkeleton({ label = "Loading…", cards = 4 }: { label?: string; cards?: number }) {
  return (
    <div role="status" aria-live="polite" data-loading="">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <div className="mb-2 h-8 w-48 max-w-[70%] animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
        <div className="mb-6 h-4 w-72 max-w-[85%] animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
        <ul className="space-y-3">
          {Array.from({ length: cards }, (_, i) => (
            <li key={i} className="space-y-2.5 rounded-card border border-border bg-surface p-4">
              <span className="block h-4 w-2/3 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
              <span className="block h-3.5 w-1/2 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
              <span className="block h-3.5 w-5/6 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
