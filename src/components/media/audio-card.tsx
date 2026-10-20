"use client";

import { Headphones, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { durationLabel, formatDuration } from "@/lib/media/format";
import { PlayerControls } from "./player-controls";
import { usePlayer, type Track } from "./player-provider";

/**
 * "Listen" card on a detail page. Starting it hands the audio to the
 * persistent player, so it keeps playing while the member moves around the
 * app; while it is the current track, the full controls show here too.
 */
export function AudioCard({ track, resumeAt, label = "Listen" }: { track: Track; resumeAt?: number | null; label?: string }) {
  const player = usePlayer();
  const current = player?.track?.key === track.key;
  const playing = current && (player?.status === "playing" || player?.status === "loading");
  const resume = !current && resumeAt && resumeAt > 5 && (!track.duration || resumeAt < track.duration - 10) ? resumeAt : null;
  return (
    <section aria-label={`${label}: ${track.title}`} className="rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden="true">
          <Headphones className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text">{label}</p>
          <p className="text-meta text-text-secondary">
            {durationLabel(track.duration) ?? "Audio"}
            {resume ? ` · You stopped at ${formatDuration(resume)}` : ""}
          </p>
        </div>
        {player ? (
          <Button
            onClick={() => (current ? player.toggle() : player.play(track, resume ?? undefined))}
            icon={playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
            aria-label={playing ? `Pause ${track.title}` : resume ? `Resume ${track.title}` : `Play ${track.title}`}
          >
            {playing ? "Pause" : resume ? "Resume" : "Play"}
          </Button>
        ) : null}
      </div>
      {current && player ? (
        <div className="mt-4">
          <PlayerControls player={player} />
        </div>
      ) : null}
    </section>
  );
}
