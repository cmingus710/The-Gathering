"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "Community" back link on a post. When the reader came from the feed in
 * this tab it goes Back in history, so the feed comes back at the same
 * scroll position with the same posts loaded; otherwise it opens the feed.
 */
export function BackToFeed({ href }: { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        let fromFeed = false;
        try {
          fromFeed = sessionStorage.getItem("community:from-feed") === "1" && window.history.length > 1;
        } catch {}
        if (!fromFeed) return;
        e.preventDefault();
        router.back();
      }}
      className="mb-3 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden="true" /> Community
    </Link>
  );
}
