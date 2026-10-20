import "server-only";
import { FeedParseError, parseFeed, type FeedEpisode } from "./feed";
import type { MediaJob } from "./jobs";
import { safeFetch, SafeFetchError } from "./safe-fetch";

/**
 * Fetches and parses one external podcast feed into the shape media.ingest()
 * expects. Never throws: failures become { ok: false, error } so the show
 * records the problem and backs off. Conditional requests (ETag and
 * Last-Modified) avoid re-downloading unchanged feeds.
 */
export type IngestResult =
  | {
      ok: true;
      not_modified?: boolean;
      etag?: string | null;
      last_modified?: string | null;
      feed?: { description: string; author: string | null; artwork_url: string | null; website_url: string | null };
      episodes?: FeedEpisode[];
    }
  | { ok: false; error: string };

export async function fetchFeed(feedUrl: string, validators: { etag?: string | null; last_modified?: string | null } = {}): Promise<IngestResult> {
  const headers: Record<string, string> = {};
  if (validators.etag) headers["if-none-match"] = validators.etag;
  if (validators.last_modified) headers["if-modified-since"] = validators.last_modified;
  try {
    const res = await safeFetch(feedUrl, { headers, timeoutMs: 15_000, maxBytes: 8 * 1024 * 1024 });
    if (res.status === 304) return { ok: true, not_modified: true };
    if (res.status === 404 || res.status === 410) return { ok: false, error: `The feed is no longer available (HTTP ${res.status}).` };
    if (res.status === 401 || res.status === 403) return { ok: false, error: "The feed requires a login or isn't public, so it can't be imported." };
    if (res.status < 200 || res.status >= 300) return { ok: false, error: `The feed server responded with HTTP ${res.status}.` };
    const feed = parseFeed(res.body);
    const header = (name: string) => {
      const v = res.headers[name];
      return (Array.isArray(v) ? v[0] : v) ?? null;
    };
    return {
      ok: true,
      etag: header("etag")?.slice(0, 300) ?? null,
      last_modified: header("last-modified")?.slice(0, 100) ?? null,
      feed: { description: feed.description, author: feed.author, artwork_url: feed.artwork_url, website_url: feed.website_url },
      episodes: feed.episodes,
    };
  } catch (err) {
    if (err instanceof SafeFetchError || err instanceof FeedParseError) return { ok: false, error: err.message };
    return { ok: false, error: "The feed couldn't be read." };
  }
}

/** Scheduled refresh: claim due shows (leased for 10 minutes), fetch, and record each result. */
export async function refreshDueFeeds(job: MediaJob, opts: { limit?: number } = {}) {
  const claimed = await job<Array<{ id: string; feed_url: string; etag: string | null; last_modified: string | null }>>("feeds_claim", {
    limit: opts.limit ?? 5,
  });
  let ok = 0;
  let failed = 0;
  for (const show of claimed ?? []) {
    const result = await fetchFeed(show.feed_url, show);
    try {
      await job("feed_result", { show_id: show.id, result });
      if (result.ok) ok++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { claimed: claimed?.length ?? 0, ok, failed };
}
