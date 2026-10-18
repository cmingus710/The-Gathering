"use client";

import { CircleCheck, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * Offers a one-tap install button where the browser supports it (Chrome, Edge,
 * Samsung Internet on Android and desktop). Safari users follow the written
 * steps on the page instead.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a browser-only value once after mount
    setInstalled(standalone);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <p role="status" className="flex items-center gap-2 font-semibold text-success">
        <CircleCheck className="size-5" aria-hidden="true" />
        The Gathering is installed on this device.
      </p>
    );
  }
  if (!event) return null;
  return (
    <Button
      icon={<Download className="size-5" aria-hidden="true" />}
      onClick={async () => {
        await event.prompt();
        const choice = await event.userChoice;
        if (choice.outcome === "accepted") setInstalled(true);
        setEvent(null);
      }}
    >
      Install The Gathering
    </Button>
  );
}
