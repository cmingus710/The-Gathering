import type { ReactNode } from "react";
import { menuArtSource } from "@/lib/home/launcher";

/**
 * Compact heading shared by the Prayer pages: the branded Prayer artwork
 * beside the title, a short description, and the primary action (right-aligned
 * when there's room, full width on a phone). `shortcut` sits at the end of the
 * title row on a phone only (for example, a jump to the care tools that
 * appear in a side panel on wider screens).
 */
export function PrayerHeader({ description, action, shortcut }: { description: ReactNode; action?: ReactNode; shortcut?: ReactNode }) {
  const art = menuArtSource("prayer");
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 sm:mb-5">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {art ? (
            // Decorative: the dimensional Prayer artwork supplied for the menu.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art.src} srcSet={art.srcSet} sizes="48px" alt="" width={48} height={48} className="size-11 shrink-0 object-contain sm:size-12" />
          ) : null}
          <h1 className="font-display text-display font-semibold leading-tight text-text sm:text-[2.125rem]">Prayer</h1>
          {shortcut ? <div className="ml-auto shrink-0 lg:hidden">{shortcut}</div> : null}
        </div>
        <p className="mt-1 max-w-[60ch] text-text-secondary [overflow-wrap:anywhere]">{description}</p>
      </div>
      {action ? <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
    </header>
  );
}
