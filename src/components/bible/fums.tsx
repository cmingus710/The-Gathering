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
const FUMS_SRC = "https://cdn.scripture.api.bible/fums/fumsv2.min.js";

/**
 * Reports one display of API.Bible text that appeared after the page loaded
 * (a memory verse revealed during practice). Loads the script once.
 */
export function trackFums(id: string | null | undefined) {
  if (!id || typeof document === "undefined") return;
  if (window._BAPI) return window._BAPI.t(id);
  let script = document.querySelector<HTMLScriptElement>(`script[src="${FUMS_SRC}"]`);
  if (!script) {
    script = document.createElement("script");
    script.src = FUMS_SRC;
    script.async = true;
    document.head.appendChild(script);
  }
  script.addEventListener("load", () => window._BAPI?.t(id), { once: true });
}

export function FumsTracker({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <Script
      src={FUMS_SRC}
      strategy="afterInteractive"
      onLoad={() => {
        for (const id of ids) window._BAPI?.t(id);
      }}
    />
  );
}
