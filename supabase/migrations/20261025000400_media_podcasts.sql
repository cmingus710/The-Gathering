-- Phase 7 · Podcasts: church-hosted shows (episodes are media.items of kind
-- 'episode' with the shared audio player) and external shows (a public RSS
-- feed and/or an official provider page), plus the optional public RSS
-- feed and search across the teaching library.
--
-- External feeds are fetched by the app server (SSRF-safe fetch, size and
-- time limits, no XML entities, descriptions reduced to plain text) and
-- handed to media.ingest() through either a manager's session (manual
-- refresh) or the signed media_job (scheduled refresh). Only metadata and
-- the publisher's own audio URL are stored; nothing is downloaded or
-- re-hosted, and imports never create notifications.

-- ---------------------------------------------------------------------------
-- Show JSON
-- ---------------------------------------------------------------------------
create function media.show_json(s media.shows, p_viewer uuid, p_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'title', s.title, 'description', s.description, 'author', s.author,
    'artwork_url', s.artwork_url, 'website_url', s.website_url,
    'artwork', (select jsonb_build_object('asset_id', a.id, 'path', a.path, 'variant_path', a.variant_path, 'alt', coalesce(a.alt_text, ''))
                  from media.assets a where a.id = s.artwork_asset_id and a.status = 'ready'
                    and (p_admin or s.audience <> 'public' or a.public_ok or media.is_member(p_viewer))),
    'provider', s.provider, 'provider_url', s.provider_url, 'provider_ref', s.provider_ref,
    'allow_stream', s.allow_stream, 'featured', s.featured, 'audience', s.audience, 'public_feed', s.public_feed,
    'episode_count', case when s.kind = 'church'
                          then (select count(*) from media.items i where i.show_id = s.id and (p_admin or media.item_visible(i, p_viewer)))
                          else (select count(*) from media.external_episodes e where e.show_id = s.id and e.missing_since is null) end,
    'latest_at', case when s.kind = 'church'
                      then (select max(i.publish_at) from media.items i where i.show_id = s.id and (p_admin or media.item_visible(i, p_viewer)))
                      else (select max(e.published_at) from media.external_episodes e where e.show_id = s.id and e.missing_since is null) end,
    'bookmarked', p_viewer is not null and exists (select 1 from media.bookmarks b
                                                     where b.profile_id = p_viewer and b.target_type = 'show' and b.target_id = s.id));
$$;

create function media.external_episode_json(e media.external_episodes, s media.shows, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'show_id', e.show_id, 'show_title', s.title, 'title', e.title, 'description', e.description,
    'link', e.link, 'artwork_url', coalesce(e.artwork_url, s.artwork_url), 'published_at', e.published_at,
    'duration_seconds', e.duration_seconds,
    -- The publisher's audio is offered only when the administrator confirmed
    -- that in-app playback is permitted.
    'audio_url', case when s.allow_stream then e.audio_url end,
    'audio_type', case when s.allow_stream then e.audio_type end,
    'provider', s.provider, 'provider_url', s.provider_url, 'provider_ref', s.provider_ref);
$$;

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------
create function public.media_admin_shows()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform media.require_manager();
  return coalesce((select jsonb_agg(media.show_json(s, null, true) || jsonb_build_object(
                     'status', s.status, 'sort_order', s.sort_order, 'feed_url', s.feed_url,
                     'group_name', (select g.name from community.groups g where g.id = s.group_id),
                     'last_fetched_at', s.last_fetched_at, 'last_success_at', s.last_success_at, 'fetch_error', s.fetch_error,
                     'consecutive_failures', s.consecutive_failures, 'refresh_due_at', s.refresh_due_at)
                   order by s.status = 'archived', s.featured desc, s.sort_order, s.title)
                     from media.shows s), '[]'::jsonb);
end;
$$;

create function public.media_admin_show(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s media.shows;
begin
  perform media.require_manager();
  select * into s from media.shows where id = p_id;
  if s.id is null then
    raise exception 'Show not found.' using errcode = 'P0002';
  end if;
  return to_jsonb(s) || media.show_json(s, null, true) || jsonb_build_object(
    'group_name', (select g.name from community.groups g where g.id = s.group_id),
    'episodes', case when s.kind = 'church' then coalesce((
                  select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'state', media.item_state(i), 'publish_at', i.publish_at,
                                                      'audience', i.audience, 'episode_number', i.episode_number)
                                   order by i.publish_at desc nulls first, i.created_at desc)
                    from media.items i where i.show_id = s.id), '[]'::jsonb)
                else coalesce((
                  select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'published_at', e.published_at,
                                                      'missing_since', e.missing_since, 'has_audio', e.audio_url is not null)
                                   order by e.published_at desc nulls last)
                    from (select * from media.external_episodes e where e.show_id = s.id
                           order by e.published_at desc nulls last limit 100) e), '[]'::jsonb) end);
end;
$$;

create function public.media_admin_show_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('podcasts.manage');
  s media.shows;
  v_audience media.audience;
  v_group uuid;
  v_kind text;
  v_fields text[] := array(select jsonb_object_keys(p));
begin
  if p_id is not null then
    select * into s from media.shows where id = p_id for update;
    if s.id is null then
      raise exception 'Show not found.' using errcode = 'P0002';
    end if;
  end if;
  v_kind := coalesce(s.kind, p ->> 'kind');
  if v_kind not in ('church', 'external') then
    raise exception 'Choose a church show or an external show.' using errcode = '22023';
  end if;
  v_audience := coalesce(nullif(p ->> 'audience', '')::media.audience, s.audience, 'members');
  v_group := case when v_audience = 'group' then coalesce(nullif(p ->> 'group_id', '')::uuid, s.group_id) end;
  if v_audience = 'group' and not exists (select 1 from community.groups where id = v_group and status = 'active') then
    raise exception 'Choose an active group.' using errcode = '22023';
  end if;
  if v_audience = 'public' and v_audience is distinct from s.audience and coalesce(p ->> 'confirm_public', '') <> 'public' then
    raise exception 'Confirm that this show should be listed for anyone, including people who are not signed in.' using errcode = '22023';
  end if;
  if nullif(p ->> 'artwork_asset_id', '') is not null
     and not exists (select 1 from media.assets where id = (p ->> 'artwork_asset_id')::uuid and kind = 'image' and status = 'ready') then
    raise exception 'Choose a ready image for the artwork.' using errcode = '22023';
  end if;
  if coalesce((p ->> 'public_feed')::boolean, s.public_feed, false) and (v_kind <> 'church' or v_audience <> 'public') then
    raise exception 'Only a public church show can publish the public podcast feed. Turn the feed off first.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into media.shows (kind, title, audience, group_id, feed_url, provider_url, created_by, refresh_due_at)
    values (v_kind, coalesce(nullif(btrim(p ->> 'title'), ''), 'Untitled show'), v_audience, v_group,
            case when v_kind = 'external' then nullif(p ->> 'feed_url', '') end,
            case when v_kind = 'external' then nullif(p ->> 'provider_url', '') end, v_uid,
            case when v_kind = 'external' and nullif(p ->> 'feed_url', '') is not null then now() end)
    returning * into s;
  end if;
  update media.shows
     set title = case when p ? 'title' then btrim(p ->> 'title') else title end,
         description = case when p ? 'description' then left(coalesce(p ->> 'description', ''), 4000) else description end,
         author = case when p ? 'author' then nullif(btrim(p ->> 'author'), '') else author end,
         artwork_asset_id = case when p ? 'artwork_asset_id' then nullif(p ->> 'artwork_asset_id', '')::uuid else artwork_asset_id end,
         website_url = case when p ? 'website_url' then nullif(btrim(p ->> 'website_url'), '') else website_url end,
         feed_url = case when kind = 'external' and p ? 'feed_url' then nullif(btrim(p ->> 'feed_url'), '') else feed_url end,
         provider = case when kind = 'external' and p ? 'provider' then nullif(p ->> 'provider', '') else provider end,
         provider_url = case when kind = 'external' and p ? 'provider_url' then nullif(btrim(p ->> 'provider_url'), '') else provider_url end,
         provider_ref = case when kind = 'external' and p ? 'provider_ref' then nullif(btrim(p ->> 'provider_ref'), '') else provider_ref end,
         allow_stream = case when kind = 'external' and p ? 'allow_stream' then coalesce((p ->> 'allow_stream')::boolean, false) else allow_stream end,
         audience = v_audience,
         group_id = v_group,
         featured = case when p ? 'featured' then coalesce((p ->> 'featured')::boolean, false) else featured end,
         sort_order = case when p ? 'sort_order' then coalesce((p ->> 'sort_order')::integer, 100) else sort_order end,
         public_feed = case when p ? 'public_feed' then kind = 'church' and coalesce((p ->> 'public_feed')::boolean, false) else public_feed end,
         feed_language = case when p ? 'feed_language' then coalesce(nullif(p ->> 'feed_language', ''), 'en-us') else feed_language end,
         feed_category = case when p ? 'feed_category' then coalesce(nullif(btrim(p ->> 'feed_category'), ''), feed_category) else feed_category end,
         feed_explicit = case when p ? 'feed_explicit' then coalesce((p ->> 'feed_explicit')::boolean, false) else feed_explicit end,
         feed_owner_email = case when p ? 'feed_owner_email' then nullif(btrim(p ->> 'feed_owner_email'), '') else feed_owner_email end,
         updated_at = now()
   where id = s.id
  returning * into s;
  -- A changed feed address starts over: refresh soon, forget validators.
  if s.kind = 'external' and p ? 'feed_url' and p_id is not null then
    update media.shows set etag = null, last_modified = null, consecutive_failures = 0, fetch_error = null, refresh_due_at = now()
     where id = s.id and feed_url is not null;
  end if;
  if s.public_feed and (s.kind <> 'church' or s.audience <> 'public') then
    raise exception 'Only a public church show can publish the public podcast feed.' using errcode = '22023';
  end if;
  perform media.audit(case when p_id is null then 'media.show_created' else 'media.show_updated' end, 'media_show', s.id,
                      jsonb_build_object('kind', s.kind, 'fields', v_fields));
  return s.id;
end;
$$;

create function public.media_admin_show_status(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('podcasts.manage');
  s media.shows;
begin
  select * into s from media.shows where id = p_id for update;
  if s.id is null then
    raise exception 'Show not found.' using errcode = 'P0002';
  end if;
  if p_action = 'publish' then
    update media.shows set status = 'published', archived_at = null, updated_at = now() where id = s.id;
  elsif p_action = 'unpublish' then
    update media.shows set status = 'draft', updated_at = now() where id = s.id;
  elsif p_action = 'archive' then
    update media.shows set status = 'archived', archived_at = now(), featured = false, public_feed = false, lease_until = null, updated_at = now()
     where id = s.id;
  elsif p_action = 'restore' then
    update media.shows set status = 'draft', archived_at = null, updated_at = now() where id = s.id and status = 'archived';
  elsif p_action = 'delete' then
    -- Removing an external show deletes its imported episode metadata.
    -- Church shows with episodes are archived instead.
    if s.status <> 'archived' then
      raise exception 'Archive the show before deleting it.' using errcode = '22023';
    end if;
    if exists (select 1 from media.items where show_id = s.id) then
      raise exception 'This show has church episodes. Keep it archived instead.' using errcode = '22023';
    end if;
    delete from media.shows where id = s.id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform media.audit('media.show_' || p_action, 'media_show', s.id, jsonb_build_object('kind', s.kind));
end;
$$;

-- ---------------------------------------------------------------------------
-- Feed ingestion
-- ---------------------------------------------------------------------------
-- r: { ok, error?, not_modified?, etag?, last_modified?,
--      feed: { description?, author?, artwork_url?, website_url? },
--      episodes: [{ guid, title, description, link, artwork_url, published_at,
--                   duration_seconds, audio_url, audio_type, audio_length }] }
create function media.ingest(p_show uuid, r jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s media.shows;
  st media.settings;
  e jsonb;
  v_added integer := 0;
  v_updated integer := 0;
  v_missing integer := 0;
  v_hashes text[] := '{}';
  v_hash text;
  v_inserted boolean;
begin
  select * into s from media.shows where id = p_show and kind = 'external' for update;
  if s.id is null then
    raise exception 'Show not found.' using errcode = 'P0002';
  end if;
  select * into st from media.settings;
  if not coalesce((r ->> 'ok')::boolean, false) then
    update media.shows
       set last_fetched_at = now(), lease_until = null,
           consecutive_failures = consecutive_failures + 1,
           fetch_error = left(coalesce(nullif(r ->> 'error', ''), 'The feed could not be read'), 300),
           -- Back off: 30 min, 2 h, 4.5 h … up to a day.
           refresh_due_at = now() + least(make_interval(mins => 30 * (consecutive_failures + 1) * (consecutive_failures + 1)), interval '24 hours')
     where id = s.id;
    return jsonb_build_object('ok', false);
  end if;
  if coalesce((r ->> 'not_modified')::boolean, false) then
    update media.shows
       set last_fetched_at = now(), last_success_at = now(), lease_until = null, consecutive_failures = 0, fetch_error = null,
           refresh_due_at = now() + make_interval(mins => st.feed_refresh_minutes)
     where id = s.id;
    return jsonb_build_object('ok', true, 'not_modified', true);
  end if;
  for e in select * from jsonb_array_elements(coalesce(r -> 'episodes', '[]'::jsonb)) limit 500 loop
    continue when nullif(btrim(e ->> 'guid'), '') is null or nullif(btrim(e ->> 'title'), '') is null;
    v_hash := md5(e ->> 'guid');
    continue when v_hash = any (v_hashes);
    v_hashes := v_hashes || v_hash;
    insert into media.external_episodes as x (show_id, guid, guid_hash, title, description, link, artwork_url, published_at,
                                              duration_seconds, audio_url, audio_type, audio_length)
    values (s.id, left(e ->> 'guid', 1000), v_hash, left(btrim(e ->> 'title'), 300), left(coalesce(e ->> 'description', ''), 8000),
            case when e ->> 'link' ~ '^https?://' then left(e ->> 'link', 1000) end,
            case when e ->> 'artwork_url' ~ '^https://' then left(e ->> 'artwork_url', 1000) end,
            nullif(e ->> 'published_at', '')::timestamptz,
            case when (e ->> 'duration_seconds') ~ '^\d{1,5}$' and (e ->> 'duration_seconds')::integer between 1 and 86400
                 then (e ->> 'duration_seconds')::integer end,
            case when e ->> 'audio_url' ~ '^https://' and char_length(e ->> 'audio_url') <= 2000 then e ->> 'audio_url' end,
            left(nullif(e ->> 'audio_type', ''), 80),
            case when (e ->> 'audio_length') ~ '^\d{1,15}$' then (e ->> 'audio_length')::bigint end)
    on conflict (show_id, guid_hash) do update
      -- Same episode: keep its identity, follow changed details and URLs.
      set title = excluded.title, description = excluded.description, link = excluded.link,
          artwork_url = excluded.artwork_url, published_at = coalesce(excluded.published_at, x.published_at),
          duration_seconds = coalesce(excluded.duration_seconds, x.duration_seconds),
          audio_url = excluded.audio_url, audio_type = excluded.audio_type, audio_length = excluded.audio_length,
          last_seen_at = now(), missing_since = null
    returning (xmax = 0) into v_inserted;
    if v_inserted then
      v_added := v_added + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;
  -- Episodes the publisher removed are hidden (kept until the show is
  -- deleted). An empty feed is treated as a fault, not a removal.
  if cardinality(v_hashes) > 0 then
    update media.external_episodes set missing_since = now()
     where show_id = s.id and missing_since is null and not (guid_hash = any (v_hashes));
    get diagnostics v_missing = row_count;
  end if;
  update media.shows
     set last_fetched_at = now(), last_success_at = now(), lease_until = null, consecutive_failures = 0,
         fetch_error = case when cardinality(v_hashes) = 0 then 'The feed has no episodes' end,
         etag = left(nullif(r ->> 'etag', ''), 300), last_modified = left(nullif(r ->> 'last_modified', ''), 100),
         description = case when description = '' then left(coalesce(r -> 'feed' ->> 'description', ''), 4000) else description end,
         author = coalesce(author, left(nullif(r -> 'feed' ->> 'author', ''), 160)),
         artwork_url = case when (r -> 'feed' ->> 'artwork_url') ~ '^https://' then left(r -> 'feed' ->> 'artwork_url', 1000) else artwork_url end,
         website_url = coalesce(website_url, case when (r -> 'feed' ->> 'website_url') ~ '^https?://' then left(r -> 'feed' ->> 'website_url', 1000) end),
         episode_count = (select count(*) from media.external_episodes where show_id = s.id and missing_since is null),
         refresh_due_at = now() + make_interval(mins => st.feed_refresh_minutes)
   where id = s.id;
  return jsonb_build_object('ok', true, 'added', v_added, 'updated', v_updated, 'missing', v_missing);
end;
$$;

-- Manual refresh from the admin page. The app first claims the show (at
-- most once a minute per show, 30 refreshes per 10 minutes per manager),
-- fetches the feed with the same safeguards as the scheduler, then ingests.
create function public.media_admin_show_claim(p_show uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('podcasts.manage');
  s media.shows;
begin
  select * into s from media.shows where id = p_show and kind = 'external' for update;
  if s.id is null or s.feed_url is null then
    raise exception 'This show has no feed to refresh.' using errcode = '22023';
  end if;
  if s.last_fetched_at > now() - interval '1 minute' or s.lease_until > now() then
    raise exception 'This feed was refreshed a moment ago. Try again in a minute.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'media.feed_refresh', 30, interval '10 minutes');
  update media.shows set lease_until = now() + interval '2 minutes' where id = s.id;
  return jsonb_build_object('id', s.id, 'feed_url', s.feed_url, 'etag', s.etag, 'last_modified', s.last_modified);
end;
$$;

create function public.media_admin_show_ingest(p_show uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform media.require_cap('podcasts.manage');
  if not exists (select 1 from media.shows where id = p_show and lease_until > now()) then
    raise exception 'Refresh the feed again.' using errcode = '22023';
  end if;
  return media.ingest(p_show, p_result);
end;
$$;

create function media.has_due_feeds()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from media.shows
                  where kind = 'external' and feed_url is not null and status <> 'archived'
                    and coalesce(refresh_due_at, '-infinity') <= now()
                    and coalesce(lease_until, '-infinity') < now());
$$;

create function media.op_feeds_claim(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((v ->> 'limit')::integer, 5), 1), 20);
  v_out jsonb := '[]'::jsonb;
  s record;
begin
  for s in
    select id, feed_url, etag, last_modified from media.shows
     where kind = 'external' and feed_url is not null and status <> 'archived'
       and coalesce(refresh_due_at, '-infinity') <= now()
       and coalesce(lease_until, '-infinity') < now()
     order by refresh_due_at nulls first
     limit v_limit
     for update skip locked
  loop
    update media.shows set lease_until = now() + interval '10 minutes' where id = s.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', s.id, 'feed_url', s.feed_url, 'etag', s.etag, 'last_modified', s.last_modified));
  end loop;
  return v_out;
end;
$$;

-- The app server's signed entry point for scheduled feed refreshes, with
-- the same secret and timestamp rule as events_job/community_job and a
-- 'media.' prefix in the signed string (no replay across jobs).
create function public.media_job(p_op text, p_payload text, p_ts bigint, p_sig text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v jsonb;
begin
  select value into v_key from events.secrets where name = 'job';
  if v_key is null then
    raise exception 'Media jobs are not configured.' using errcode = '42501';
  end if;
  if p_ts is null or abs(extract(epoch from now()) - p_ts) > 300 then
    raise exception 'Request expired.' using errcode = '42501';
  end if;
  if p_sig is null
     or p_sig <> encode(extensions.hmac('media.' || coalesce(p_op, '') || '.' || p_ts::text || '.' || coalesce(p_payload, ''), v_key, 'sha256'), 'hex') then
    raise exception 'Invalid signature.' using errcode = '42501';
  end if;
  v := coalesce(nullif(p_payload, ''), '{}')::jsonb;
  return case p_op
    when 'feeds_claim' then media.op_feeds_claim(v)
    when 'feed_result' then media.ingest((v ->> 'show_id')::uuid, v -> 'result')
    else null
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members and visitors
-- ---------------------------------------------------------------------------
create function public.media_shows()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  return jsonb_build_object(
    'shows', coalesce((select jsonb_agg(media.show_json(s, v_uid, false) order by s.featured desc, s.sort_order, s.title)
                         from media.shows s where media.show_visible(s, v_uid)), '[]'::jsonb),
    -- Recent episodes across shows (church and external).
    'recent', coalesce((select jsonb_agg(x.j order by x.at desc nulls last)
                          from (select y.j, y.at from (
                                  select media.item_card(i, v_uid) || jsonb_build_object('type', 'church') j, i.publish_at at
                                    from media.items i where i.kind = 'episode' and media.item_visible(i, v_uid)
                                  union all
                                  select media.external_episode_json(e, s, v_uid) || jsonb_build_object('type', 'external'), e.published_at
                                    from media.external_episodes e join media.shows s on s.id = e.show_id
                                   where e.missing_since is null and media.show_visible(s, v_uid)) y
                                 order by y.at desc nulls last limit 12) x), '[]'::jsonb));
end;
$$;

create function public.media_show(p_id uuid, p_q text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s media.shows;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  select * into s from media.shows where id = p_id;
  if s.id is null or not media.show_visible(s, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if s.kind = 'church' then
    return media.show_json(s, v_uid, false) || (
      with f as (select i.* from media.items i
                  where i.show_id = s.id and media.item_visible(i, v_uid) and media.matches(i, jsonb_build_object('q', p_q)))
      select jsonb_build_object(
        'episodes', coalesce((select jsonb_agg(media.item_card(x, v_uid) || jsonb_build_object('type', 'church') order by x.publish_at desc)
                                from (select * from f order by f.publish_at desc limit v_limit offset v_offset) x), '[]'::jsonb),
        'total', (select count(*) from f)));
  end if;
  return media.show_json(s, v_uid, false) || (
    with f as (select e.* from media.external_episodes e
                where e.show_id = s.id and e.missing_since is null
                  and (nullif(p_q, '') is null or e.title ilike media.like_pattern(p_q) or e.description ilike media.like_pattern(p_q)))
    select jsonb_build_object(
      'episodes', coalesce((select jsonb_agg(media.external_episode_json(x, s, v_uid) || jsonb_build_object('type', 'external')
                                             order by x.published_at desc nulls last)
                              from (select * from f order by f.published_at desc nulls last limit v_limit offset v_offset) x), '[]'::jsonb),
      'total', (select count(*) from f)));
end;
$$;

create function public.media_external_episode(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e media.external_episodes;
  s media.shows;
begin
  select * into e from media.external_episodes where id = p_id and missing_since is null;
  select * into s from media.shows where id = e.show_id;
  if e.id is null or not media.show_visible(s, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return media.external_episode_json(e, s, v_uid) || jsonb_build_object(
    'progress', (select jsonb_build_object('position', p.position_seconds, 'completed', p.completed)
                   from media.progress p where v_uid is not null and p.profile_id = v_uid and p.media_key = 'e:' || e.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Public podcast feed: only the church show that is public and has the
-- feed switched on, and only its episodes that are live, public, and whose
-- audio file is approved for public use with confirmed rights. Member-only
-- or group content never appears, and enclosure URLs are stable app URLs
-- (never expiring storage links).
-- ---------------------------------------------------------------------------
create function media.feed_episode_ok(i media.items, s media.shows)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select i.kind = 'episode' and i.show_id = s.id and i.audience = 'public'
     and media.is_live(i.status, i.publish_at, i.expires_at)
     and s.public_feed and s.kind = 'church' and s.status = 'published' and s.audience = 'public'
     and exists (select 1 from media.item_media im join media.assets a on a.id = im.asset_id
                  where im.item_id = i.id and im.role = 'audio' and not im.members_only
                    and a.status = 'ready' and a.public_ok and a.rights <> 'unknown' and a.rights_confirmed_at is not null);
$$;

create function public.media_public_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s media.shows;
begin
  select * into s from media.shows where public_feed and kind = 'church' and status = 'published' and audience = 'public';
  if s.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'show', jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description, 'author', s.author,
                               'website_url', s.website_url, 'language', s.feed_language, 'category', s.feed_category,
                               'explicit', s.feed_explicit, 'owner_email', s.feed_owner_email, 'updated_at', s.updated_at,
                               'artwork', (select jsonb_build_object('asset_id', a.id, 'mime', a.mime, 'width', a.width, 'height', a.height)
                                             from media.assets a where a.id = s.artwork_asset_id and a.status = 'ready' and a.public_ok)),
    'episodes', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', i.id, 'title', i.title, 'summary', i.summary, 'body', i.body, 'publish_at', i.publish_at,
                             'episode_number', i.episode_number, 'season_number', i.season_number,
                             'audio', (select jsonb_build_object('asset_id', a.id, 'mime', a.mime, 'size_bytes', a.size_bytes,
                                                                 'duration_seconds', a.duration_seconds)
                                         from media.item_media im join media.assets a on a.id = im.asset_id
                                        where im.item_id = i.id and im.role = 'audio'))
                           order by i.publish_at desc)
                            from (select * from media.items i
                                   where media.feed_episode_ok(i, s)
                                   order by i.publish_at desc limit 300) i), '[]'::jsonb));
end;
$$;

-- Best-effort limit for signed-out endpoints, keyed by a hash the app
-- derives from the client address (never the address itself).
create function public.media_public_hit(p_key_hash text, p_action text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key_hash !~ '^[0-9a-f]{64}$' or p_action !~ '^[a-z_]{1,40}$' then
    return false;
  end if;
  if (select count(*) from (select 1 from media.public_hits
                             where key_hash = p_key_hash and action = p_action
                               and created_at > now() - make_interval(secs => least(greatest(p_window_seconds, 1), 3600))
                             limit greatest(least(p_max, 1000), 1)) x) >= greatest(least(p_max, 1000), 1) then
    return false;
  end if;
  insert into media.public_hits (key_hash, action) values (p_key_hash, p_action);
  return true;
end;
$$;

-- Stable public audio for a feed episode.
create function public.media_public_episode_audio(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i media.items;
  s media.shows;
begin
  select * into i from media.items where id = p_item and kind = 'episode';
  select * into s from media.shows where id = i.show_id;
  if i.id is null or s.id is null or not media.feed_episode_ok(i, s) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return (select jsonb_build_object('path', a.path, 'mime', a.mime, 'size_bytes', a.size_bytes)
            from media.item_media im join media.assets a on a.id = im.asset_id
           where im.item_id = i.id and im.role = 'audio');
end;
$$;

create function public.media_public_artwork()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select jsonb_build_object('path', a.path, 'mime', a.mime)
            from media.shows s join media.assets a on a.id = s.artwork_asset_id
           where s.public_feed and s.kind = 'church' and s.status = 'published' and s.audience = 'public'
             and a.status = 'ready' and a.public_ok);
end;
$$;

-- ---------------------------------------------------------------------------
-- Search across what the caller may see: teaching content, shows and
-- external episodes, and (members) album titles. Never prayer, care,
-- messages, finance, or journals.
-- ---------------------------------------------------------------------------
create function public.media_search(p_q text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_f jsonb := jsonb_build_object('q', p_q);
  v_pat text := media.like_pattern(p_q);
begin
  if char_length(btrim(coalesce(p_q, ''))) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(r.j order by r.rank, r.at desc nulls last) from (
    select y.* from (
      select media.item_card(i, v_uid) || jsonb_build_object('type', 'item') j,
             case when i.title ilike v_pat then 0 else 1 end rank, media.sort_key(i) at
        from media.items i where media.item_visible(i, v_uid) and media.matches(i, v_f)
      union all
      select media.show_json(s, v_uid, false) || jsonb_build_object('type', 'show'), 0, s.updated_at
        from media.shows s where media.show_visible(s, v_uid) and (s.title ilike v_pat or s.author ilike v_pat or s.description ilike v_pat)
      union all
      select media.external_episode_json(e, s, v_uid) || jsonb_build_object('type', 'external'),
             case when e.title ilike v_pat then 0 else 1 end, e.published_at
        from media.external_episodes e join media.shows s on s.id = e.show_id
       where e.missing_since is null and media.show_visible(s, v_uid) and (e.title ilike v_pat or e.description ilike v_pat)
      union all
      select jsonb_build_object('type', 'album', 'id', a.id, 'title', a.title, 'album_on', a.album_on), 0, a.album_on::timestamptz
        from media.albums a where media.album_visible(a, v_uid) and a.title ilike v_pat) y
    order by y.rank, y.at desc nulls last limit v_limit) r), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema media from public, anon, authenticated;
revoke execute on function
  public.media_admin_shows(), public.media_admin_show(uuid), public.media_admin_show_save(uuid, jsonb),
  public.media_admin_show_status(uuid, text), public.media_admin_show_claim(uuid), public.media_admin_show_ingest(uuid, jsonb), public.media_job(text, text, bigint, text),
  public.media_shows(), public.media_show(uuid, text, integer, integer), public.media_external_episode(uuid),
  public.media_public_feed(), public.media_public_hit(text, text, integer, integer), public.media_public_episode_audio(uuid),
  public.media_public_artwork(), public.media_search(text, integer)
from public;

grant execute on function
  public.media_admin_shows(), public.media_admin_show(uuid), public.media_admin_show_save(uuid, jsonb),
  public.media_admin_show_status(uuid, text), public.media_admin_show_claim(uuid), public.media_admin_show_ingest(uuid, jsonb)
to authenticated;

-- Visitors: public shows, the public feed, and search over public content.
grant execute on function
  public.media_shows(), public.media_show(uuid, text, integer, integer), public.media_external_episode(uuid),
  public.media_public_feed(), public.media_public_hit(text, text, integer, integer), public.media_public_episode_audio(uuid),
  public.media_public_artwork(), public.media_search(text, integer)
to anon, authenticated;

-- The signed job is called by the app server with the publishable key.
grant execute on function public.media_job(text, text, bigint, text) to anon, authenticated;
