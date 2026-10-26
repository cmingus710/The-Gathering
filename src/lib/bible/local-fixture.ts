import "server-only";
import { readFileSync } from "node:fs";
import type { Fetcher } from "./source";

/**
 * Local walkthroughs only: answers API.Bible passage requests from a file of
 * SYNTHETIC, API.Bible-shaped responses, so licensed-version flows can be
 * exercised end to end without the service or real licensed text. Every
 * other step (key check, parsing, cache, FUMS token, fingerprints) runs as
 * in production.
 *
 * Active only when BOTH hold: API_BIBLE_FIXTURE_FILE names the file, and the
 * app talks to a loopback Supabase (NEXT_PUBLIC_SUPABASE_URL on 127.0.0.1 or
 * localhost). A hosted project never matches, so a stray setting can't put
 * fixture text in front of members.
 *
 * File: { "<bible id>/<passage id>": { "content": "[16] …", "copyright": "…", "fumsToken": "…" } }
 */
type Entry = { content: string; copyright?: string; fumsToken?: string };

export function localFixtureFetcher(env: Record<string, string | undefined> = process.env): Fetcher | null {
  const file = env.API_BIBLE_FIXTURE_FILE;
  if (!file) return null;
  let host = "";
  try {
    host = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
  if (host !== "127.0.0.1" && host !== "localhost") return null;
  return (async (input: string) => {
    const entries = JSON.parse(readFileSync(file, "utf8")) as Record<string, Entry>;
    const m = /\/bibles\/([^/]+)\/passages\/([^/?]+)/.exec(input);
    const hit = m ? entries[`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`] : undefined;
    const body = hit
      ? { data: { content: hit.content, copyright: hit.copyright ?? null }, meta: { fumsToken: hit.fumsToken ?? null } }
      : { statusCode: 404, error: "Not Found" };
    return { status: hit ? 200 : 404, url: input, headers: {}, body: Buffer.from(JSON.stringify(body)) };
  }) as Fetcher;
}
