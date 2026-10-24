import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, TestDb } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * The reviewed EXECUTE baseline (20261029000100): only these public functions
 * may be called with the publishable key alone, and only the bootstrap
 * script's function by service_role. Matches the hosted project (2026-10-21).
 */
const ANON = [
  // Podcasts landing page (20261103000100): applies the caller's audience
  // rules itself, like media_shows.
  // Phase 13 (20261031000100): campaign list/detail (visibility-checked,
  // aggregate totals only) and the campaign-image storage read check.
  "can_view_campaign_image", "giving_campaign", "giving_campaigns",
  "can_view_event_image", "community_job", "events_categories", "events_feed_private", "events_feed_public", "events_job",
  "events_list", "events_occurrence", "events_public_feed_enabled", "giving_ingest", "giving_public_config", "is_approved_member",
  "media_can_read_object", "media_devotional_day", "media_external_episode", "media_facets", "media_file", "media_item",
  "media_items", "media_job", "media_podcast_episodes", "media_public_artwork", "media_public_episode_audio", "media_public_feed", "media_public_hit",
  "media_search", "media_series", "media_show", "media_shows", "media_transcript",
  // Video thumbnails (20261109000200): rechecks the caller's access to the video, like media_file.
  "media_video_thumb",
  // Sunday lessons page (20261119000100): applies the caller's audience rules itself, like media_items.
  "media_lessons",
];
const APP_SCHEMAS = ["public", "community", "events", "giving", "media", "prayer", "bible", "journal", "memory", "youth", "membership"];

describeDb("function EXECUTE baseline", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await TestDb.create();
  }, 120_000);
  afterAll(async () => db?.destroy());

  const executable = async (role: string) =>
    (
      await db.raw<{ fn: string }>(
        `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = any($1) and has_function_privilege($2, p.oid, 'execute') order by 1`,
        [APP_SCHEMAS, role],
      )
    ).map((r) => r.fn);

  it("lets anon run only the reviewed public entry points", async () => {
    expect(await executable("anon")).toEqual(ANON.map((f) => `public.${f}`).sort());
  });

  it("gives service_role only the bootstrap function", async () => {
    expect(await executable("service_role")).toEqual(["public.bootstrap_super_admin"]);
  });

  it("grants nothing to PUBLIC and keeps the restrictive default for new functions", async () => {
    const [{ n }] = await db.raw<{ n: number }>(
      `select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1) and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))`,
      [APP_SCHEMAS],
    );
    expect(n).toBe(0);
    // Same per-schema default as the hosted project: new functions in public
    // aren't granted to the API roles automatically. (PostgreSQL's global
    // PUBLIC default still applies, which is why every migration revokes
    // from public explicitly.)
    const defaults = await db.raw<{ acl: string }>(
      "select defaclacl::text acl from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace and defaclobjtype = 'f'",
    );
    for (const d of defaults) expect(d.acl).not.toMatch(/anon|authenticated|service_role/);
  });
});
