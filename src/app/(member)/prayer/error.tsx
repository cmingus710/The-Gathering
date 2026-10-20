"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Generic on purpose: no request details or error text reach the page. */
export default function PrayerError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-4">
      <Alert tone="error" title="This page couldn't be loaded right now.">
        Please check your connection and try again. Nothing you shared was changed.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
