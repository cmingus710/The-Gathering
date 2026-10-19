/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, not optimized */
import { EyeOff, UsersRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { GroupCard as Group } from "@/lib/community/types";

export function GroupImage({ url, alt, className = "size-16" }: { url: string | null | undefined; alt: string | null; className?: string }) {
  if (!url) {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-card bg-surface-muted text-primary ${className}`}>
        <UsersRound className="size-6" aria-hidden="true" />
      </span>
    );
  }
  return <img src={url} alt={alt ?? ""} className={`shrink-0 rounded-card object-cover ${className}`} />;
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
    <div className="flex gap-4 rounded-card bg-surface p-5">
      <GroupImage url={imageUrl} alt={group.image_alt} />
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-[1.05rem] font-semibold">{title}</h3>
        <p className="flex flex-wrap gap-2 text-sm font-bold uppercase tracking-wider text-text-secondary">
          {group.my_role === "leader" ? <span className="text-primary">You lead this group</span> : group.my_role ? <span className="text-primary">Member</span> : null}
          {group.visibility === "hidden" ? (
            <span className="inline-flex items-center gap-1">
              <EyeOff className="size-3.5" aria-hidden="true" /> Hidden group
            </span>
          ) : null}
          {group.status === "archived" ? <span>Archived</span> : null}
        </p>
        {group.summary ? <p className="text-[0.95rem] text-text-secondary">{group.summary}</p> : null}
        {children}
      </div>
    </div>
  );
}
