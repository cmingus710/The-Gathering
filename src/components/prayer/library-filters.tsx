import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { KIND_LABEL, KINDS, type Category, type CategoryKind } from "@/lib/prayer/library";

const ANY: Record<CategoryKind, string> = { topic: "Any topic", purpose: "Any purpose", use: "Any use" };

/**
 * Topic, purpose, and intended-use filters for a library list (a plain GET
 * form, so the choice is in the address and comes back with "Back to …").
 */
export function LibraryFilterPanel({
  action,
  hidden,
  categories,
  filters,
  resetHref,
}: {
  action: string;
  /** Other parameters the list keeps (its view). */
  hidden?: Record<string, string | null>;
  categories: Category[];
  filters: Record<CategoryKind, string | null>;
  resetHref: string;
}) {
  const activeCount = KINDS.filter((k) => filters[k]).length;
  return (
    <details open={activeCount > 0} className="group rounded-card border border-border bg-surface shadow-(--elev-card)">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-card px-4 font-semibold focus-visible:outline-3 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
        <span>Filters</span>
        <span className="text-meta font-normal text-text-secondary">{activeCount ? `${activeCount} applied` : "Topic, purpose, intended use"}</span>
        <ChevronDown className="ml-auto size-4 text-text-secondary transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <form method="get" action={action} aria-label="Filter prayers" className="border-t border-border p-4">
        {Object.entries(hidden ?? {}).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}
        <div className="grid gap-3 sm:grid-cols-3">
          {KINDS.map((kind) => (
            <label key={kind} className="space-y-1 text-meta font-semibold">
              <span className="block">{KIND_LABEL[kind]}</span>
              <select name={kind} defaultValue={filters[kind] ?? ""} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-base">
                <option value="">{ANY[kind]}</option>
                {categories
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" className="min-h-11 rounded-full border border-border-strong bg-surface px-4 text-meta font-semibold hover:bg-surface-muted">
            Apply filters
          </button>
          {activeCount ? (
            <ButtonLink href={resetHref} variant="ghost" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />}>
              Reset filters
            </ButtonLink>
          ) : null}
        </div>
      </form>
    </details>
  );
}
