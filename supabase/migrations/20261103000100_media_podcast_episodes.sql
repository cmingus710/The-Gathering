-- Podcasts landing page: every episode the caller may see (church episodes
-- and external feed episodes), newest first, each with what the page needs
-- to play it in place.
--
-- Read-only and additive. The same rules as the rest of Phase 7 apply at
-- the moment of the call: church episodes through media.item_visible (draft,
-- schedule, expiry, audience, and the show itself) and the playable file
-- through media.attachments_json / media.attachment_visible (members-only
-- and not-publicly-approved files stay with members); external episodes only
-- from visible shows, never removed ones, with the publisher's audio URL
-- only where an administrator allowed in-app playback
-- (media.external_episode_json). Audio itself still goes through
-- /api/media/<asset>/play, which rechecks access on every request.

create function public.media_podcast_episodes(p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return (
    with f as (
      select 'church'::text t, i.id, i.publish_at at
        from media.items i where i.kind = 'episode' and media.item_visible(i, v_uid)
      union all
      select 'external', e.id, e.published_at
        from media.external_episodes e join media.shows s on s.id = e.show_id
       where e.missing_since is null and media.show_visible(s, v_uid)
    ),
    -- Newest first; the id breaks ties so pages never overlap or skip.
    pg as (select f.*, row_number() over (order by f.at desc nulls last, f.id desc) n
             from f order by f.at desc nulls last, f.id desc limit v_limit offset v_offset)
    select jsonb_build_object(
      'total', (select count(*) from f),
      'episodes', coalesce((select jsonb_agg(x.j order by p.n) from pg p cross join lateral (
        select media.item_card(i, v_uid) || jsonb_build_object(
                 'type', 'church',
                 -- The file the page plays: the episode's audio, else its video.
                 'play', pl.a,
                 'progress', (select jsonb_build_object('position', pr.position_seconds, 'completed', pr.completed)
                                from media.progress pr
                               where v_uid is not null and pr.profile_id = v_uid and pr.media_key = 'a:' || (pl.a ->> 'asset_id'))) j
          from media.items i
          left join lateral (select a from jsonb_array_elements(media.attachments_json(i, v_uid, false)) a
                              where a ->> 'role' in ('audio', 'video')
                              order by case a ->> 'role' when 'audio' then 0 else 1 end limit 1) pl on true
         where p.t = 'church' and i.id = p.id
        union all
        select media.external_episode_json(e, s, v_uid) || jsonb_build_object(
                 'type', 'external',
                 'progress', (select jsonb_build_object('position', pr.position_seconds, 'completed', pr.completed)
                                from media.progress pr
                               where v_uid is not null and pr.profile_id = v_uid and pr.media_key = 'e:' || e.id))
          from media.external_episodes e join media.shows s on s.id = e.show_id
         where p.t = 'external' and e.id = p.id) x), '[]'::jsonb)));
end;
$$;

revoke execute on function public.media_podcast_episodes(integer, integer) from public, anon, authenticated, service_role;
-- Reviewed anonymous entry point (tests/db/grants.test.ts): like
-- media_shows, it applies the caller's audience rules itself, so visitors
-- see only public episodes and publicly approved files.
grant execute on function public.media_podcast_episodes(integer, integer) to anon, authenticated;
