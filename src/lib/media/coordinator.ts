"use client";

/**
 * One player at a time. Every player (the persistent audio player, a native
 * video, or a loaded third-party embed) registers how to pause itself and
 * claims playback when it starts; the coordinator pauses whoever was
 * playing before. For providers without a pause API the registered pause
 * unloads the embed, which stops it. Cross-provider coordination is best
 * effort: a third-party player that doesn't report "play" can't be paused
 * by the app (see docs/media-limitations.md).
 */
type Entry = { pause: () => void };

const players = new Map<string, Entry>();
let active: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export function registerPlayer(id: string, entry: Entry): () => void {
  players.set(id, entry);
  return () => {
    players.delete(id);
    if (active === id) setActive(null);
  };
}

function setActive(id: string | null) {
  active = id;
  for (const l of listeners) l(id);
}

/** Call when a player starts: everyone else is paused. */
export function claimPlayback(id: string) {
  if (active === id) return;
  for (const [other, entry] of players) {
    if (other !== id) {
      try {
        entry.pause();
      } catch {
        // A player that can't be paused (detached iframe) is ignored.
      }
    }
  }
  setActive(id);
}

export function releasePlayback(id: string) {
  if (active === id) setActive(null);
}

export function activePlayer(): string | null {
  return active;
}

export function onActiveChange(listener: (id: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
