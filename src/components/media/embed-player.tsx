"use client";

import { ExternalLink, Play } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { claimPlayback, registerPlayer, releasePlayback } from "@/lib/media/coordinator";
import { EMBED_ORIGINS, type Embed } from "@/lib/media/embeds";

const PROVIDER_NAME: Record<Embed["provider"], string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  spotify: "Spotify",
  apple: "Apple Podcasts",
};

/**
 * A third-party player that loads only when the person asks for it
 * (privacy: nothing is requested from the provider before that). The src
 * is always rebuilt from a parsed identifier on the server (never
 * administrator-supplied HTML). "Open in …" works even when the provider
 * blocks embedding or playback fails.
 *
 * Coordination: YouTube and Vimeo are paused through their official
 * postMessage commands and report when they start; Spotify and Apple embeds
 * are unloaded when another player starts (their position is kept by the
 * provider, not by this app).
 */
export function EmbedPlayer({ embed, title, note }: { embed: Embed; title: string; note?: string | null }) {
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const id = `embed:${useId()}`;
  const origins = EMBED_ORIGINS[embed.provider] as readonly string[];
  const name = PROVIDER_NAME[embed.provider];

  const post = useCallback(
    (message: unknown) => {
      const w = frame.current?.contentWindow;
      if (!w) return;
      for (const origin of origins) w.postMessage(JSON.stringify(message), origin);
    },
    [origins],
  );

  useEffect(
    () =>
      registerPlayer(id, {
        pause: () => {
          if (!frame.current) return;
          if (embed.provider === "youtube") post({ event: "command", func: "pauseVideo", args: [] });
          else if (embed.provider === "vimeo") post({ method: "pause" });
          else setLoaded(false);
        },
      }),
    [embed.provider, id, post],
  );

  useEffect(() => {
    if (!loaded) {
      releasePlayback(id);
      return;
    }
    const onMessage = (e: MessageEvent) => {
      if (!origins.includes(e.origin) || e.source !== frame.current?.contentWindow) return;
      let data: unknown = e.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const d = data as { event?: string; info?: { playerState?: number } | number };
      const ytPlaying = d.event === "onStateChange" ? d.info === 1 : d.event === "infoDelivery" && typeof d.info === "object" && d.info?.playerState === 1;
      if (ytPlaying || (embed.provider === "vimeo" && d.event === "play")) claimPlayback(id);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed.provider, id, loaded, origins]);

  const onLoad = () => {
    // Ask the player to report its state (both providers' documented message APIs).
    if (embed.provider === "youtube") post({ event: "listening", id, channel: "widget" });
    if (embed.provider === "vimeo") post({ method: "addEventListener", value: "play" });
  };

  const height = embed.height;
  return (
    <div className="space-y-2">
      {loaded ? (
        <div className={height ? "overflow-hidden rounded-card" : "aspect-video overflow-hidden rounded-card bg-black"} style={height ? { height } : undefined}>
          <iframe
            ref={frame}
            src={embed.src}
            title={title}
            allow={embed.allow}
            sandbox={embed.sandbox}
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
            className="size-full border-0"
            style={height ? { height } : undefined}
            onLoad={onLoad}
          />
        </div>
      ) : (
        <div className={`flex flex-col items-center justify-center gap-3 rounded-card border border-border bg-surface-muted p-5 text-center ${height ? "" : "aspect-video"}`}>
          <p className="max-w-sm text-meta text-text-secondary">
            Plays from {name}. Loading it shares your visit with {name}
            {embed.provider === "spotify" ? ", and full tracks need you to be signed in to Spotify in this browser" : ""}.
          </p>
          <Button
            onClick={() => {
              claimPlayback(id);
              setLoaded(true);
            }}
            icon={<Play className="size-5" aria-hidden="true" />}
            aria-label={`Load the ${name} player for ${title}`}
          >
            {embed.provider === "youtube" || embed.provider === "vimeo" ? "Load video" : "Load player"}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {note ? <p className="text-[0.8125rem] text-text-secondary">{note}</p> : <span />}
        <a
          href={embed.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-meta font-semibold text-primary hover:bg-primary-soft"
        >
          {embed.openLabel}
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only">(opens a new tab)</span>
        </a>
      </div>
    </div>
  );
}
