"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-checks the confirmation a few times while the webhook arrives. */
export function AutoRefresh({ intervalMs = 4000, maxTries = 10 }: { intervalMs?: number; maxTries?: number }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= maxTries) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      router.refresh();
    }, intervalMs);
    return () => clearTimeout(t);
  }, [tries, maxTries, intervalMs, router]);
  return (
    <p className="mt-3 text-sm text-text-secondary" role="status">
      {tries < maxTries ? "Checking for confirmation…" : "Still waiting. You can safely close this page."}
    </p>
  );
}
