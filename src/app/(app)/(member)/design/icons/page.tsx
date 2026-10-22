import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon, SpotIcon, TileIcon } from "@/components/icons/icon";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { GLYPHS, ICON_NAMES } from "@/lib/icons";

export const metadata: Metadata = { title: "Icon reference", robots: { index: false, follow: false } };

function Panel({ theme }: { theme: "light" | "dark" }) {
  return (
    <section data-theme={theme} aria-labelledby={`icons-${theme}`} className="rounded-card border border-border p-4 sm:p-5">
      <h2 id={`icons-${theme}`} className="mb-3 font-display text-xl font-semibold">
        {theme === "light" ? "Light theme" : "Dark theme"}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ICON_NAMES.map((name) => (
          <li key={name} className="flex items-center gap-3 rounded-tile border border-border bg-surface p-3">
            <TileIcon name={name} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{GLYPHS[name].label}</p>
              <p className="text-meta text-text-secondary">{GLYPHS[name].concept}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-3 text-text-secondary" aria-label="Navigation sizes: 20 and 24 pixels, unselected then selected">
                <Icon name={name} className="size-5" />
                <Icon name={name} className="size-6" />
                <span className="text-text">
                  <Icon name={name} active className="size-5" />
                </span>
                <span className="text-text">
                  <Icon name={name} active className="size-6" />
                </span>
                <SpotIcon name={name} className="size-10" />
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Internal reference for the custom icon set: every glyph at navigation size
 * (20/24 px, unselected and selected), as an illustrated tile, and as an
 * empty-state spot, in both themes. Administrators only; not linked for members.
 */
export default async function IconReferencePage() {
  const viewer = await requireApprovedMember("/design/icons");
  if (!viewer.isAdmin) notFound();
  return (
    <div className="layout-wide">
      <PageHeader
        eyebrow="Design system"
        title="Icon reference"
        description="Custom SVG icons: 24-unit grid, 1.75 stroke (2 when selected), round joins, charcoal or ivory structure with gold highlights."
      />
      <div className="space-y-4">
        <Panel theme="light" />
        <Panel theme="dark" />
      </div>
    </div>
  );
}
