"use client";

import { ChevronDown, ChevronUp, Pause, Play, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { claimPlayback, registerPlayer, releasePlayback } from "@/lib/media/coordinator";
import { formatDuration } from "@/lib/media/format";
import { saveProgress } from "@/lib/media/player-actions";
import { PlayerControls } from "./player-controls";

/**
 * The app's one native audio player. It lives in the root layout, so
 * playback continues across navigation (member, public, and admin pages).
 * A compact mini-player floats above the phone dock and its safe area.
 *
 * - Only a person's tap starts playback (never autoplay).
 * - Starting audio pauses any video or embed through the coordinator.
 * - Media Session metadata and handlers give lock-screen and headset
 *   controls where the browser supports them (not guaranteed everywhere).
 * - Members' positions are saved every 15 seconds, on pause, and at the end.
 * - Church audio plays through /api/media/<id>/play, which rechecks access
 *   and redirects to a short-lived storage link; if that link expires
 *   mid-listen the player reloads it once at the same position.
 */
export type Track = {
  /** 'a:<asset id>' (church media) or 'e:<external episode id>' */
  key: string;
  itemId: string | null;
  src: string;
  title: string;
  subtitle?: string | null;
  artwork?: string | null;
  href?: string | null;
  duration?: number | null;
  captions?: Array<{ src: string; label: string; language: string }>;
  /** Save the member's position (signed-in members only). */
  saveProgress: boolean;
};

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

type PlayerState = {
  track: Track | null;
  status: PlayerStatus;
  position: number;
  duration: number | null;
  rate: number;
  volume: number;
  muted: boolean;
  error: string | null;
  cue: string | null;
  showCaptions: boolean;
};

type PlayerApi = PlayerState & {
  play: (track: Track, startAt?: number) => void;
  toggle: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleCaptions: () => void;
  retry: () => void;
  close: () => void;
};

const PlayerContext = createContext<PlayerApi | null>(null);
const PLAYER_ID = "audio-player";
const SAVE_EVERY_MS = 15_000;

export function usePlayer(): PlayerApi | null {
  return useContext(PlayerContext);
}

function readRate(): number {
  try {
    const v = Number(window.localStorage.getItem("player-rate"));
    return [0.75, 1, 1.25, 1.5, 1.75, 2].includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<PlayerState>(() => ({
    track: null,
    status: "idle",
    position: 0,
    duration: null,
    // The saved speed only matters once something plays (never rendered on the server).
    rate: typeof window === "undefined" ? 1 : readRate(),
    volume: 1,
    muted: false,
    error: null,
    cue: null,
    showCaptions: false,
  }));
  const [expanded, setExpanded] = useState(false);
  const trackRef = useRef<Track | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const retried = useRef(false);
  const lastSaved = useRef(0);
  const lastUiUpdate = useRef(0);
  const lastSessionUpdate = useRef(0);

  const patch = useCallback((p: Partial<PlayerState>) => setState((s) => ({ ...s, ...p })), []);

  const persist = useCallback((completed = false) => {
    const a = audioRef.current;
    const t = trackRef.current;
    if (!a || !t?.saveProgress) return;
    lastSaved.current = Date.now();
    const duration = Number.isFinite(a.duration) ? a.duration : (t.duration ?? null);
    void saveProgress(t.key, t.itemId, completed ? 0 : a.currentTime, duration, completed).catch(() => undefined);
  }, []);

  useEffect(() => registerPlayer(PLAYER_ID, { pause: () => audioRef.current?.pause() }), []);

  // The page reserves room for the mini-player while it is shown.
  useEffect(() => {
    const root = document.documentElement;
    if (state.track) root.dataset.player = "on";
    else delete root.dataset.player;
    return () => {
      delete root.dataset.player;
    };
  }, [state.track]);

  const updateMediaSession = useCallback((t: Track | null) => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!t) {
      ms.metadata = null;
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title: t.title,
        artist: t.subtitle ?? "",
        album: "The Gathering",
        artwork: t.artwork ? [{ src: t.artwork, sizes: "512x512" }] : [],
      });
      const a = () => audioRef.current;
      ms.setActionHandler("play", () => void a()?.play());
      ms.setActionHandler("pause", () => a()?.pause());
      ms.setActionHandler("seekbackward", (d) => a() && (a()!.currentTime = Math.max(0, a()!.currentTime - (d.seekOffset ?? 15))));
      ms.setActionHandler("seekforward", (d) => a() && (a()!.currentTime = Math.min(a()!.duration || Infinity, a()!.currentTime + (d.seekOffset ?? 30))));
      ms.setActionHandler("seekto", (d) => {
        if (a() && d.seekTime != null) a()!.currentTime = d.seekTime;
      });
      ms.setActionHandler("stop", () => a()?.pause());
    } catch {
      // Some browsers support only part of the Media Session API.
    }
  }, []);

  const play = useCallback(
    (track: Track, startAt?: number) => {
      const a = audioRef.current;
      if (!a) return;
      const same = trackRef.current?.key === track.key;
      if (same && a.src) {
        void a.play().catch(() => undefined);
        return;
      }
      if (trackRef.current) persist();
      trackRef.current = track;
      retried.current = false;
      pendingSeek.current = startAt && startAt > 5 && (!track.duration || startAt < track.duration - 10) ? startAt : null;
      setState((s) => ({ ...s, track, status: "loading", position: pendingSeek.current ?? 0, duration: track.duration ?? null, error: null, cue: null }));
      a.src = track.src;
      a.playbackRate = state.rate;
      // play() is called inside the tap that started it (autoplay rules).
      void a.play().catch((err: DOMException) => {
        if (err?.name === "NotAllowedError") patch({ status: "paused" });
      });
      updateMediaSession(track);
    },
    [patch, persist, state.rate, updateMediaSession],
  );

  const api = useMemo<PlayerApi>(
    () => ({
      ...state,
      play,
      toggle: () => {
        const a = audioRef.current;
        if (!a || !trackRef.current) return;
        if (a.paused) void a.play().catch(() => undefined);
        else a.pause();
      },
      pause: () => audioRef.current?.pause(),
      seek: (seconds) => {
        const a = audioRef.current;
        if (!a) return;
        a.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(a.duration) ? a.duration : seconds));
        patch({ position: a.currentTime });
      },
      skip: (delta) => {
        const a = audioRef.current;
        if (!a) return;
        a.currentTime = Math.max(0, Math.min(a.currentTime + delta, Number.isFinite(a.duration) ? a.duration : a.currentTime + delta));
      },
      setRate: (rate) => {
        if (audioRef.current) audioRef.current.playbackRate = rate;
        try {
          window.localStorage.setItem("player-rate", String(rate));
        } catch {
          // Storage may be unavailable (private browsing); the rate still applies now.
        }
        patch({ rate });
      },
      setVolume: (volume) => {
        if (audioRef.current) {
          audioRef.current.volume = volume;
          audioRef.current.muted = volume === 0;
        }
        patch({ volume, muted: volume === 0 });
      },
      toggleMute: () => {
        const a = audioRef.current;
        if (!a) return;
        a.muted = !a.muted;
        patch({ muted: a.muted });
      },
      toggleCaptions: () => patch({ showCaptions: !state.showCaptions }),
      retry: () => {
        const a = audioRef.current;
        const t = trackRef.current;
        if (!a || !t) return;
        pendingSeek.current = state.position > 5 ? state.position : null;
        retried.current = false;
        patch({ status: "loading", error: null });
        a.src = t.src;
        void a.play().catch(() => undefined);
      },
      close: () => {
        const a = audioRef.current;
        persist();
        if (a) {
          a.pause();
          a.removeAttribute("src");
          a.load();
        }
        trackRef.current = null;
        releasePlayback(PLAYER_ID);
        updateMediaSession(null);
        setExpanded(false);
        patch({ track: null, status: "idle", position: 0, duration: null, error: null, cue: null });
      },
    }),
    [patch, persist, play, state, updateMediaSession],
  );

  // Element events.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => {
      if (pendingSeek.current != null) {
        a.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
      patch({ duration: Number.isFinite(a.duration) ? a.duration : (trackRef.current?.duration ?? null) });
    };
    const onTime = () => {
      const now = Date.now();
      if (now - lastUiUpdate.current > 250) {
        lastUiUpdate.current = now;
        patch({ position: a.currentTime });
      }
      if (now - lastSaved.current > SAVE_EVERY_MS && !a.paused) persist();
      if ("mediaSession" in navigator && Number.isFinite(a.duration) && now - lastSessionUpdate.current > 5000) {
        lastSessionUpdate.current = now;
        try {
          navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate });
        } catch {
          // Unsupported in some browsers.
        }
      }
    };
    const onPlay = () => {
      claimPlayback(PLAYER_ID);
      patch({ status: "playing", error: null });
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    };
    const onPause = () => {
      setState((s) => (s.status === "ended" || s.status === "error" ? s : { ...s, status: "paused", position: a.currentTime }));
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
      persist();
    };
    const onEnded = () => {
      patch({ status: "ended", position: a.duration || 0 });
      persist(true);
    };
    const onWaiting = () => patch({ status: "loading" });
    const onError = () => {
      const code = a.error?.code;
      const t = trackRef.current;
      // A signed link that expired mid-listen: fetch a fresh one once.
      if (t && !retried.current && code !== MediaError.MEDIA_ERR_ABORTED) {
        retried.current = true;
        pendingSeek.current = a.currentTime > 1 ? a.currentTime : pendingSeek.current;
        a.src = t.src;
        void a.play().catch(() => undefined);
        return;
      }
      patch({
        status: "error",
        error:
          code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? "This audio can't be played here. It may no longer be available to you, or this browser can't play its format."
            : "The audio couldn't be loaded. Check your connection, then try again.",
      });
    };
    const onRate = () => patch({ rate: a.playbackRate });
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("playing", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("error", onError);
    a.addEventListener("ratechange", onRate);
    const onHide = () => {
      if (document.visibilityState === "hidden" && !a.paused) persist();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("playing", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("error", onError);
      a.removeEventListener("ratechange", onRate);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [patch, persist]);

  // Captions for audio: the current cue is shown in the player.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const tracks = a.textTracks;
    const handlers: Array<() => void> = [];
    for (let i = 0; i < tracks.length; i++) {
      const tt = tracks[i];
      tt.mode = i === 0 ? "hidden" : "disabled";
      const onCue = () => {
        const cues = tt.activeCues;
        const text = cues && cues.length ? Array.from(cues).map((c) => (c as VTTCue).text.replace(/<[^>]*>/g, "")).join(" ") : null;
        patch({ cue: text });
      };
      tt.addEventListener("cuechange", onCue);
      handlers.push(() => tt.removeEventListener("cuechange", onCue));
    }
    return () => handlers.forEach((h) => h());
  }, [state.track, patch]);

  const t = state.track;
  const progress = state.duration ? Math.min(100, (state.position / state.duration) * 100) : 0;

  return (
    <PlayerContext.Provider value={api}>
      {children}
      <audio ref={audioRef} preload="metadata" className="hidden">
        {t?.captions?.map((c) => <track key={c.src} kind="captions" src={c.src} srcLang={c.language} label={c.label} />)}
      </audio>
      {t ? (
        <section aria-label="Audio player" className="mini-player fixed inset-x-3 z-40 mx-auto max-w-lg rounded-[1.25rem] sm:inset-x-6 lg:inset-x-auto lg:right-6 lg:w-[26rem]">
          <div className="h-1 overflow-hidden rounded-t-[1.25rem] bg-border/60" aria-hidden="true">
            <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center gap-3 px-3 py-2">
            {t.artwork ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed or publisher artwork; never through the image optimizer
              <img src={t.artwork} alt="" className="size-11 shrink-0 rounded-[0.625rem] object-cover" />
            ) : (
              <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-[0.625rem] bg-surface-muted text-accent">
                ♪
              </span>
            )}
            <div className="min-w-0 flex-1">
              {t.href ? (
                <Link href={t.href} className="block truncate text-meta font-semibold text-text hover:underline">
                  {t.title}
                </Link>
              ) : (
                <p className="truncate text-meta font-semibold text-text">{t.title}</p>
              )}
              <p className="truncate text-[0.8125rem] text-text-secondary">
                {state.status === "error" ? (
                  <span className="text-danger">Playback stopped</span>
                ) : (
                  <>
                    <span className="tabular-nums">
                      {formatDuration(state.position)} / {formatDuration(state.duration)}
                    </span>
                    {t.subtitle ? ` · ${t.subtitle}` : ""}
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={api.toggle}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cta text-on-cta"
              aria-label={state.status === "playing" || state.status === "loading" ? `Pause ${t.title}` : `Play ${t.title}`}
            >
              {state.status === "playing" || state.status === "loading" ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-muted hover:text-text"
              aria-expanded={expanded}
              aria-controls="mini-player-controls"
              aria-label={expanded ? "Fewer player controls" : "More player controls"}
            >
              {expanded ? <ChevronDown className="size-5" aria-hidden="true" /> : <ChevronUp className="size-5" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={api.close}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-muted hover:text-text"
              aria-label="Close the player"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div id="mini-player-controls" hidden={!expanded} className={cn("border-t border-border px-3 pb-3 pt-2")}>
            <PlayerControls player={api} />
          </div>
        </section>
      ) : null}
    </PlayerContext.Provider>
  );
}
