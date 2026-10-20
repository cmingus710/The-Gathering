import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import type { IconName } from "@/lib/icons";
import { TileCount } from "./tile-count";

export type FeatureTile = { key: string; href: string; label: string; hint: string; icon: IconName; count?: "messages" | "notifications" };

/** Compact illustrated tile for the home quick-access grid. */
export function FeatureTileLink({ tile }: { tile: FeatureTile }) {
  return (
    <Link
      href={tile.href}
      className="interactive relative flex min-h-[6.5rem] flex-col items-center justify-center gap-1.5 rounded-tile border border-border bg-surface px-2 py-3 text-center shadow-(--elev-card) hover:bg-surface-muted/50 sm:flex-row sm:justify-start sm:gap-3 sm:px-3.5 sm:text-left"
    >
      <TileIcon name={tile.icon} className="size-11 sm:size-12" />
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-semibold leading-tight text-text sm:text-title">{tile.label}</span>
        <span className="mt-0.5 hidden text-meta leading-snug text-text-secondary sm:block">{tile.hint}</span>
      </span>
      {tile.count ? <TileCount kind={tile.count} /> : null}
    </Link>
  );
}
