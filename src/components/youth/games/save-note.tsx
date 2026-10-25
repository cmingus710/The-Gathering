"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { SaveStatus } from "./use-progress-saver";

/**
 * A quiet line about saving; only a problem gets an alert. After a conflict,
 * Reload loads the page fresh so the game starts from the latest saved state.
 */
export function SaveNote({ status, preview }: { status: SaveStatus; preview?: boolean }) {
  if (preview) return <p className="text-meta text-text-secondary">Preview: progress isn&apos;t saved here.</p>;
  if (status.state === "error") {
    return (
      <Alert tone="error" title={status.message ?? "Progress couldn't be saved."}>
        {status.reload ? (
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => window.location.reload()}>
            Reload
          </Button>
        ) : null}
      </Alert>
    );
  }
  return (
    <p className="text-meta text-text-secondary" aria-live="polite">
      {status.state === "saving" ? "Saving…" : status.state === "saved" ? "Progress saved." : "Progress saves as you play, so you can come back to it later."}
    </p>
  );
}
