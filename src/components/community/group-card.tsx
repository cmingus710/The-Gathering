/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, not optimized */
import { EyeOff } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ReactNode } from "react";
import { TileIcon } from "@/components/icons/icon";
import type { GroupCard as Group } from "@/lib/community/types";

export function GroupImage({ url, alt, className = "size-16" }: { url: string | null | undefined; alt: string | null; className?: string }) {
  if (!url) {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-tile bg-surface-muted ${className}`}>
        <TileIcon name="groups" className="size-[72%]" />
      </span>
    );
  }
  return <img src={url} alt={alt ?? ""} className={`shrink-0 rounded-tile object-cover ${className}`} />;
}

export function GroupCardView({ group, imageUrl, children, href }: { group: Group; imageUrl?: string | null; children?: ReactNode; href?: string }) {
  const title = href ? (
    <Link href={href} className="hover:underline">
      {group.name}
    </Link>
  ) : (
    group.name
  );
  return (
    <div className="flex gap-4 rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <GroupImage url={imageUrl} alt={group.image_alt} />
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="font-display text-[1.1875rem] font-semibold leading-snug">{title}</h3>
        <p className="flex flex-wrap gap-2 text-meta font-semibold text-text-secondary empty:hidden">
          {group.my_role === "leader" ? <Badge tone="warning">You lead this group</Badge> : group.my_role ? <Badge tone="success">Member</Badge> : null}
          {group.visibility === "hidden" ? (
            <span className="inline-flex items-center gap-1">
              <EyeOff className="size-3.5" aria-hidden="true" /> Hidden group
            </span>
          ) : null}
          {group.status === "archived" ? <span>Archived</span> : null}
        </p>
        {group.summary ? <p className="text-meta text-text-secondary">{group.summary}</p> : null}
        {children}
      </div>
    </div>
  );
}
