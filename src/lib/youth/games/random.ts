/**
 * Seeded randomness for Learn & Play boards. A board is always rebuilt from
 * its seed (saved with the child's progress), so it stays the same through a
 * session, a reload, or a resume on another device, and a new seed is drawn
 * only when the child starts over or plays again.
 */
export const MAX_SEED = 2 ** 31 - 1;

/** Mulberry32: small, fast, and good enough for shuffling cards. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded generator; the input is not changed. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The seed for the next board after this one (deterministic, never 0). */
export function nextSeed(seed: number): number {
  return Math.floor(rng(seed ^ 0x5bd1e995)() * (MAX_SEED - 1)) + 1;
}

/** A fresh seed (the server draws one per page load, so hydration matches). */
export function freshSeed(): number {
  return Math.floor(Math.random() * (MAX_SEED - 1)) + 1;
}

export function isSeed(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_SEED;
}
