import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";

export function DateRangeForm({ action, from, to, children }: { action: string; from: string; to: string; children?: ReactNode }) {
  return (
    <form action={action} className="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="range-from" className="block text-sm font-semibold">
          From
        </label>
        <input id="range-from" type="date" name="from" defaultValue={from} className="min-h-11 rounded-control border border-border-strong bg-surface px-3" />
      </div>
      <div>
        <label htmlFor="range-to" className="block text-sm font-semibold">
          To
        </label>
        <input id="range-to" type="date" name="to" defaultValue={to} className="min-h-11 rounded-control border border-border-strong bg-surface px-3" />
      </div>
      {children}
      <button type="submit" className={buttonClasses("secondary", "sm")}>
        Apply
      </button>
    </form>
  );
}
