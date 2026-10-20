"use client";

import Script from "next/script";

declare global {
  interface Window {
    _BAPI?: { t: (id: string) => void };
  }
}

/**
 * API.Bible's Fair Use Management System: its terms require this tracking
 * script wherever its scripture is shown on the web. Loaded only on pages
 * that actually show API.Bible text (never for stored or public-domain
 * text). Not verified against the live service; see docs/bible-sources.md.
 */
export function FumsTracker({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <Script
      src="https://cdn.scripture.api.bible/fums/fumsv2.min.js"
      strategy="afterInteractive"
      onLoad={() => {
        for (const id of ids) window._BAPI?.t(id);
      }}
    />
  );
}
