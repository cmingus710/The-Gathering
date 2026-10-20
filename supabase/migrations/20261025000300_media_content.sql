-- Phase 7 · Teaching content: devotionals, Sunday lessons, church podcast
-- episodes, church reading (books and weekly assignments), and playlists.
--
-- Editing and publishing are separate: content.edit holders write and
-- preview drafts; only content.publish holders publish, schedule, change a
-- live item, feature it, make it public (with an explicit confirmation), or
-- archive it. Publishing church-hosted files needs confirmed rights.
--
-- Member functions are callable by visitors (public content) and members.
-- Every list, detail, search result, related link, bookmark, progress
-- record, and playback lookup applies media.item_visible /
-- media.attachment_visible for the caller at the moment of the call.

-- ---------------------------------------------------------------------------
-- JSON builders
-- ---------------------------------------------------------------------------
create function media.item_state(i media.items)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when i.status = 'archived' then 'archived'
    when i.status = 'draft' then 'draft'
    when i.publish_at > now() then 'scheduled'
    when i.expires_at is not null and i.expires_at <= now() then 'expired'
    else 'live' end;
$$;

create function media.cover_json(i media.items, p_viewer uuid, p_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('asset_id', a.id, 'path', a.path, 'variant_path', a.variant_path,
                            'alt', coalesce(nullif(i.cover_alt, ''), a.alt_text, ''), 'width', a.width, 'height', a.height)
    from media.assets a
   where a.id = i.cover_asset_id and a.status = 'ready' and a.kind = 'image'
     and (p_admin or i.audience <> 'public' or a.public_ok or media.is_member(p_viewer));
$$;

create function media.people_json(p_item uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', ip.role) order by ip.sort_order, p.name), '[]'::jsonb)
    from media.item_people ip join media.people p on p.id = ip.person_id
   where ip.item_id = p_item;
$$;

-- Attachments the viewer may use (all of them for administrators).
create function media.attachments_json(i media.items, p_viewer uuid, p_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'asset_id', a.id, 'role', im.role, 'label', coalesce(im.label, a.title), 'title', a.title, 'kind', a.kind,
           'mime', a.mime, 'size_bytes', a.size_bytes, 'duration_seconds', a.duration_seconds, 'width', a.width, 'height', a.height,
           'members_only', im.members_only, 'public_ok', a.public_ok, 'status', a.status,
           'provider', a.provider, 'provider_ref', a.provider_ref, 'provider_hash', a.provider_hash, 'external_url', a.external_url,
           'path', a.path, 'has_transcript', a.transcript is not null,
           'rights', case when p_admin then a.rights end,
           'rights_confirmed', a.rights_confirmed_at is not null,
           'attribution', a.attribution,
           'captions', coalesce((select jsonb_agg(jsonb_build_object('asset_id', c.id, 'language', c.language,
                                                                     'label', coalesce(c.label, upper(c.language))) order by c.created_at)
                                   from media.assets c where c.parent_id = a.id and c.kind = 'captions' and c.status = 'ready'), '[]'::jsonb))
         order by case im.role when 'video' then 0 when 'audio' then 1 when 'handout' then 2 when 'slides' then 3 else 4 end, im.sort_order, a.title), '[]'::jsonb)
    from media.item_media im join media.assets a on a.id = im.asset_id
   where im.item_id = i.id
     and (p_admin or (a.status = 'ready' and media.attachment_visible(i, im.members_only, a.public_ok, p_viewer)));
$$;

-- Compact card for lists, search, related links, and the home page.
create function media.item_card(i media.items, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'kind', i.kind, 'title', i.title, 'summary', i.summary, 'audience', i.audience, 'featured', i.featured,
    'publish_at', i.publish_at, 'devotional_on', i.devotional_on, 'delivered_on', i.delivered_on,
    'starts_on', i.starts_on, 'ends_on', i.ends_on, 'episode_number', i.episode_number, 'season_number', i.season_number,
    'book_author', i.book_author, 'book_current', i.book_current, 'spotify_id', i.spotify_id,
    'scripture_refs', to_jsonb(i.scripture_refs), 'tags', to_jsonb(i.tags),
    'cover', media.cover_json(i, p_viewer, false),
    'series', (select jsonb_build_object('id', s.id, 'title', s.title) from media.series s where s.id = i.series_id and not s.archived),
    'show', (select jsonb_build_object('id', s.id, 'title', s.title) from media.shows s where s.id = i.show_id),
    'book', (select jsonb_build_object('id', b.id, 'title', b.title, 'book_author', b.book_author)
               from media.items b where b.id = i.book_id and media.item_visible(b, p_viewer)),
    'people', media.people_json(i.id),
    'media', (select jsonb_build_object(
                'audio', bool_or(im.role = 'audio'), 'video', bool_or(im.role = 'video'),
                'duration_seconds', max(a.duration_seconds) filter (where im.role in ('audio', 'video')))
                from media.item_media im join media.assets a on a.id = im.asset_id
               where im.item_id = i.id and a.status = 'ready' and media.attachment_visible(i, im.members_only, a.public_ok, p_viewer)),
    'bookmarked', p_viewer is not null and exists (select 1 from media.bookmarks b
                                                     where b.profile_id = p_viewer and b.target_type = 'item' and b.target_id = i.id),
    'completed', p_viewer is not null and exists (select 1 from media.completions c where c.profile_id = p_viewer and c.item_id = i.id));
$$;

create function media.item_detail(i media.items, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select media.item_card(i, p_viewer) || jsonb_build_object(
    'body', i.body, 'notes', i.notes, 'questions', to_jsonb(i.questions), 'instructions', i.instructions,
    'attribution', i.attribution, 'audible_url', i.audible_url,
    'group_name', (select g.name from community.groups g where g.id = i.group_id and community.group_member(g.id, p_viewer)),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                          from media.item_topics it join media.topics t on t.id = it.topic_id where it.item_id = i.id), '[]'::jsonb),
    'attachments', media.attachments_json(i, p_viewer, false),
    'related', coalesce((select jsonb_agg(media.item_card(r, p_viewer) order by r.publish_at desc)
                           from media.items r
                          where r.id in (select to_item from media.item_links where from_item = i.id
                                         union select from_item from media.item_links where to_item = i.id)
                            and media.item_visible(r, p_viewer)), '[]'::jsonb),
    -- Only when the viewer can read the discussion (never broader than the item).
    'discussion', (select jsonb_build_object('thread_id', t.id, 'title', t.title, 'replies', t.reply_count,
                                             'group', (select g.name from community.groups g where g.id = t.group_id))
                     from community.threads t
                    where t.id = i.discussion_thread_id and t.status = 'visible'
                      and community.can_read_thread(t.id, p_viewer)),
    'progress', coalesce((select jsonb_object_agg(pr.media_key, jsonb_build_object('position', pr.position_seconds, 'completed', pr.completed))
                            from media.progress pr
                           where p_viewer is not null and pr.profile_id = p_viewer
                             and pr.media_key in (select 'a:' || im.asset_id from media.item_media im where im.item_id = i.id)), '{}'::jsonb),
    -- A book's assignments, and an assignment's sibling assignments.
    'assignments', case when i.kind in ('book', 'assignment') then coalesce((
                     select jsonb_agg(media.item_card(x, p_viewer) order by x.starts_on desc)
                       from media.items x
                      where x.kind = 'assignment' and x.book_id = coalesce(case when i.kind = 'book' then i.id end, i.book_id)
                        and x.id <> i.id and media.item_visible(x, p_viewer)), '[]'::jsonb) end);
$$;

-- Everything for editors and the preview (drafts included).
create function media.item_admin_json(i media.items)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(i) - 'client_key'
    || jsonb_build_object(
      'state', media.item_state(i),
      'cover', media.cover_json(i, null, true),
      'people', media.people_json(i.id),
      'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                            from media.item_topics it join media.topics t on t.id = it.topic_id where it.item_id = i.id), '[]'::jsonb),
      'attachments', media.attachments_json(i, null, true),
      'links', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'state', media.item_state(r)))
                           from media.items r
                          where r.id in (select to_item from media.item_links where from_item = i.id
                                         union select from_item from media.item_links where to_item = i.id)), '[]'::jsonb),
      'series', (select jsonb_build_object('id', s.id, 'title', s.title) from media.series s where s.id = i.series_id),
      'show', (select jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status, 'audience', s.audience) from media.shows s where s.id = i.show_id),
      'book', (select jsonb_build_object('id', b.id, 'title', b.title) from media.items b where b.id = i.book_id),
      'group_name', (select g.name from community.groups g where g.id = i.group_id),
      'discussion', (select jsonb_build_object('thread_id', t.id, 'title', t.title, 'group_id', t.group_id,
                                               'group', (select g.name from community.groups g where g.id = t.group_id))
                       from community.threads t where t.id = i.discussion_thread_id),
      'created_by_name', case when i.created_by is not null then community.display_name(i.created_by) end,
      'updated_by_name', case when i.updated_by is not null then community.display_name(i.updated_by) end,
      -- Files a publisher must confirm rights for before publishing.
      'rights_missing', coalesce((select jsonb_agg(a.title order by a.title)
                                    from media.item_media im join media.assets a on a.id = im.asset_id
                                   where im.item_id = i.id and a.kind in ('audio', 'video', 'document')
                                     and (a.rights = 'unknown' or a.rights_confirmed_at is null)), '[]'::jsonb),
      -- Files that stay members-only when the item is public.
      'members_only_files', case when i.audience = 'public' then coalesce((
                               select jsonb_agg(a.title order by a.title)
                                 from media.item_media im join media.assets a on a.id = im.asset_id
                                where im.item_id = i.id and (im.members_only or not a.public_ok)), '[]'::jsonb) else '[]'::jsonb end);
$$;

-- ---------------------------------------------------------------------------
-- Administration: lists, details, saving, publishing
-- ---------------------------------------------------------------------------
create function media.require_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if not media.is_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function public.media_admin_items(p_kind text, p_state text, p_q text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform media.require_manager();
  return (
    with f as (
      select i.* from media.items i
       where (p_kind is null or i.kind::text = p_kind)
         and (p_state is null or media.item_state(i) = p_state)
         and (p_state is not null or i.status <> 'archived')
         and (p_q is null or i.title ilike media.like_pattern(p_q) or i.summary ilike media.like_pattern(p_q)))
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', x.id, 'kind', x.kind, 'title', x.title, 'state', media.item_state(x), 'audience', x.audience,
                           'group_name', (select g.name from community.groups g where g.id = x.group_id),
                           'featured', x.featured, 'publish_at', x.publish_at, 'expires_at', x.expires_at,
                           'devotional_on', x.devotional_on, 'delivered_on', x.delivered_on, 'starts_on', x.starts_on,
                           'updated_at', x.updated_at,
                           'show', (select s.title from media.shows s where s.id = x.show_id))
                         order by coalesce(x.devotional_on, x.delivered_on, x.starts_on, x.publish_at::date, x.created_at::date) desc, x.updated_at desc)
                           from (select * from f
                                  order by coalesce(f.devotional_on, f.delivered_on, f.starts_on, f.publish_at::date, f.created_at::date) desc, f.updated_at desc
                                  limit v_limit offset v_offset) x), '[]'::jsonb),
      'total', (select count(*) from f)));
end;
$$;

create function public.media_admin_item(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i media.items;
begin
  perform media.require_manager();
  select * into i from media.items where id = p_id;
  if i.id is null then
    raise exception 'Content not found.' using errcode = 'P0002';
  end if;
  return media.item_admin_json(i);
end;
$$;

-- Choices for the editor form.
create function public.media_admin_item_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_manager();
begin
  return jsonb_build_object(
    'shows', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status, 'audience', s.audience) order by s.title)
                         from media.shows s where s.kind = 'church' and s.status <> 'archived'), '[]'::jsonb),
    'books', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'state', media.item_state(b)) order by b.title)
                         from media.items b where b.kind = 'book' and b.status <> 'archived'), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                          from community.groups g where g.status = 'active'), '[]'::jsonb),
    -- Recent discussions the editor can read, to link from content.
    'threads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'group_id', t.group_id,
                                                             'group', (select g.name from community.groups g where g.id = t.group_id))
                                          order by t.last_activity_at desc)
                           from (select * from community.threads t
                                  where t.status = 'visible' and community.can_read_thread(t.id, v_uid)
                                  order by t.last_activity_at desc limit 60) t), '[]'::jsonb),
    'can_publish', public.has_capability('content.publish'),
    'can_manage_media', public.has_capability('media.manage'));
end;
$$;

-- Validates attachments and references, then writes the draft fields.
-- Editors (content.edit) change drafts only; changing scheduled or live
-- content, featuring, the current book, and public audiences need
-- content.publish. A public audience needs p ->> 'confirm_public' = 'public'.
create function public.media_admin_item_save(p_id uuid, p jsonb, p_client_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  v_publisher boolean := public.has_capability('content.publish');
  i media.items;
  v_new boolean := p_id is null;
  v_kind media.item_kind;
  v_audience media.audience;
  v_group uuid;
  v_thread uuid;
  v_att jsonb;
  v_x jsonb;
  v_role text;
  a media.assets;
  v_fields text[] := array(select jsonb_object_keys(p));
begin
  if v_new then
    if p_client_key is not null then
      select * into i from media.items where created_by = v_uid and client_key = p_client_key;
      if i.id is not null then
        return jsonb_build_object('id', i.id, 'created', false);
      end if;
    end if;
    v_kind := (p ->> 'kind')::media.item_kind;
    if v_kind is null then
      raise exception 'Choose what kind of content this is.' using errcode = '22023';
    end if;
  else
    select * into i from media.items where id = p_id for update;
    if i.id is null then
      raise exception 'Content not found.' using errcode = 'P0002';
    end if;
    v_kind := i.kind;
    if i.status <> 'draft' and not v_publisher then
      raise exception 'Only publishers can change content that is scheduled, published, or archived.' using errcode = '42501';
    end if;
  end if;

  v_audience := coalesce(nullif(p ->> 'audience', '')::media.audience, i.audience, 'members');
  v_group := case when v_audience = 'group' then coalesce(nullif(p ->> 'group_id', '')::uuid, i.group_id) end;
  if v_audience = 'group' and not exists (select 1 from community.groups where id = v_group and status = 'active') then
    raise exception 'Choose an active group.' using errcode = '22023';
  end if;
  if v_audience = 'public' and v_audience is distinct from i.audience then
    if not v_publisher then
      raise exception 'Only publishers can make content public.' using errcode = '42501';
    end if;
    if coalesce(p ->> 'confirm_public', '') <> 'public' then
      raise exception 'Confirm that this should be visible to anyone, including people who are not signed in.' using errcode = '22023';
    end if;
  end if;
  if v_kind not in ('devotional', 'lesson', 'episode') and v_audience = 'public' then
    raise exception 'This kind of content can be shared with members or a group only.' using errcode = '22023';
  end if;
  if (p ? 'featured' and (p ->> 'featured')::boolean is distinct from coalesce(i.featured, false))
     or (p ? 'book_current' and (p ->> 'book_current')::boolean is distinct from coalesce(i.book_current, false)) then
    if not v_publisher then
      raise exception 'Only publishers can feature content.' using errcode = '42501';
    end if;
  end if;
  v_thread := case when p ? 'discussion_thread_id' then nullif(p ->> 'discussion_thread_id', '')::uuid else i.discussion_thread_id end;
  if v_thread is not null and (v_thread is distinct from i.discussion_thread_id or v_audience is distinct from i.audience or v_group is distinct from i.group_id) then
    if not community.can_read_thread(v_thread, v_uid) then
      raise exception 'Choose a discussion you can read.' using errcode = '22023';
    end if;
    if not media.thread_fits(v_thread, v_audience, v_group) then
      raise exception 'The linked discussion would reach people outside this content''s audience. Choose a discussion in the same group, or remove the link.' using errcode = '22023';
    end if;
  end if;
  if nullif(p ->> 'cover_asset_id', '') is not null
     and not exists (select 1 from media.assets where id = (p ->> 'cover_asset_id')::uuid and kind = 'image' and status = 'ready') then
    raise exception 'Choose a ready image for the cover.' using errcode = '22023';
  end if;
  if v_kind = 'episode' and nullif(p ->> 'show_id', '') is not null
     and not exists (select 1 from media.shows where id = (p ->> 'show_id')::uuid and kind = 'church') then
    raise exception 'Choose one of the church''s podcast shows.' using errcode = '22023';
  end if;
  if v_kind = 'assignment' and nullif(p ->> 'book_id', '') is not null
     and not exists (select 1 from media.items where id = (p ->> 'book_id')::uuid and kind = 'book') then
    raise exception 'Choose a book from the church library.' using errcode = '22023';
  end if;

  if v_new then
    insert into media.items (kind, title, audience, group_id, devotional_on, delivered_on, show_id, book_id, starts_on, spotify_id,
                             client_key, created_by, updated_by)
    values (v_kind, coalesce(nullif(btrim(p ->> 'title'), ''), 'Untitled'), v_audience, v_group,
            coalesce(nullif(p ->> 'devotional_on', '')::date, case when v_kind = 'devotional' then media.church_today() end),
            coalesce(nullif(p ->> 'delivered_on', '')::date, case when v_kind = 'lesson' then media.church_today() end),
            nullif(p ->> 'show_id', '')::uuid, nullif(p ->> 'book_id', '')::uuid,
            coalesce(nullif(p ->> 'starts_on', '')::date, case when v_kind = 'assignment' then media.church_today() end),
            nullif(p ->> 'spotify_id', ''), p_client_key, v_uid, v_uid)
    returning * into i;
  end if;

  update media.items
     set title = case when p ? 'title' then btrim(p ->> 'title') else title end,
         summary = case when p ? 'summary' then left(btrim(coalesce(p ->> 'summary', '')), 600) else summary end,
         body = case when p ? 'body' then coalesce(p ->> 'body', '') else body end,
         notes = case when p ? 'notes' then coalesce(p ->> 'notes', '') else notes end,
         questions = case when p ? 'questions' then array(select btrim(q) from jsonb_array_elements_text(p -> 'questions') q
                                                           where btrim(q) <> '' limit 20) else questions end,
         cover_asset_id = case when p ? 'cover_asset_id' then nullif(p ->> 'cover_asset_id', '')::uuid else cover_asset_id end,
         cover_alt = case when p ? 'cover_alt' then nullif(btrim(p ->> 'cover_alt'), '') else cover_alt end,
         audience = v_audience,
         group_id = v_group,
         featured = case when p ? 'featured' then coalesce((p ->> 'featured')::boolean, false) else featured end,
         sort_order = case when p ? 'sort_order' then coalesce((p ->> 'sort_order')::integer, 100) else sort_order end,
         series_id = case when p ? 'series_id' then nullif(p ->> 'series_id', '')::uuid else series_id end,
         tags = case when p ? 'tags' then array(select distinct lower(btrim(t)) from jsonb_array_elements_text(p -> 'tags') t
                                               where btrim(t) <> '' and char_length(btrim(t)) <= 40 limit 20) else tags end,
         scripture_refs = case when p ? 'scripture_refs' then array(select btrim(r) from jsonb_array_elements_text(p -> 'scripture_refs') r
                                                                   where btrim(r) <> '' and char_length(btrim(r)) <= 80 limit 20) else scripture_refs end,
         attribution = case when p ? 'attribution' then nullif(btrim(p ->> 'attribution'), '') else attribution end,
         -- Required for its kind: an empty value keeps the current date.
         devotional_on = case when p ? 'devotional_on' then coalesce(nullif(p ->> 'devotional_on', '')::date, devotional_on) else devotional_on end,
         -- Required for its kind: an empty value keeps the current date.
         delivered_on = case when p ? 'delivered_on' then coalesce(nullif(p ->> 'delivered_on', '')::date, delivered_on) else delivered_on end,
         show_id = case when p ? 'show_id' and kind = 'episode' then nullif(p ->> 'show_id', '')::uuid else show_id end,
         episode_number = case when p ? 'episode_number' then nullif(p ->> 'episode_number', '')::integer else episode_number end,
         season_number = case when p ? 'season_number' then nullif(p ->> 'season_number', '')::integer else season_number end,
         book_author = case when p ? 'book_author' then nullif(btrim(p ->> 'book_author'), '') else book_author end,
         audible_url = case when p ? 'audible_url' then nullif(btrim(p ->> 'audible_url'), '') else audible_url end,
         book_current = case when p ? 'book_current' then coalesce((p ->> 'book_current')::boolean, false) else book_current end,
         book_id = case when p ? 'book_id' and kind = 'assignment' then nullif(p ->> 'book_id', '')::uuid else book_id end,
         -- Required for its kind: an empty value keeps the current date.
         starts_on = case when p ? 'starts_on' then coalesce(nullif(p ->> 'starts_on', '')::date, starts_on) else starts_on end,
         ends_on = case when p ? 'ends_on' then nullif(p ->> 'ends_on', '')::date else ends_on end,
         instructions = case when p ? 'instructions' then nullif(btrim(p ->> 'instructions'), '') else instructions end,
         spotify_id = case when p ? 'spotify_id' and kind = 'playlist' then nullif(p ->> 'spotify_id', '') else spotify_id end,
         discussion_thread_id = v_thread,
         notify = case when p ? 'notify' then coalesce((p ->> 'notify')::boolean, false) else notify end,
         updated_by = v_uid, updated_at = now()
   where id = i.id
  returning * into i;

  if p ? 'people' then
    delete from media.item_people where item_id = i.id;
    insert into media.item_people (item_id, person_id, role, sort_order)
    select i.id, (x ->> 'person_id')::uuid, x ->> 'role', n
      from jsonb_array_elements(p -> 'people') with ordinality as e(x, n)
     where exists (select 1 from media.people pp where pp.id = (x ->> 'person_id')::uuid)
    on conflict do nothing;
  end if;
  if p ? 'topics' then
    delete from media.item_topics where item_id = i.id;
    insert into media.item_topics (item_id, topic_id)
    select i.id, t.id from media.topics t where t.id in (select (jsonb_array_elements_text(p -> 'topics'))::uuid)
    on conflict do nothing;
  end if;
  if p ? 'links' then
    delete from media.item_links where from_item = i.id or to_item = i.id;
    insert into media.item_links (from_item, to_item)
    select i.id, r.id from media.items r
     where r.id in (select (jsonb_array_elements_text(p -> 'links'))::uuid) and r.id <> i.id
    on conflict do nothing;
  end if;
  if p ? 'attachments' then
    delete from media.item_media where item_id = i.id;
    for v_att in select * from jsonb_array_elements(p -> 'attachments') loop
      select * into a from media.assets where id = (v_att ->> 'asset_id')::uuid;
      v_role := v_att ->> 'role';
      if a.id is null or a.status <> 'ready' then
        raise exception 'One of the files isn''t ready. Wait for processing to finish, or choose another file.' using errcode = '22023';
      end if;
      if not (case v_role
                when 'audio' then a.kind = 'audio'
                when 'video' then a.kind in ('video', 'external_video')
                when 'handout' then a.kind = 'document'
                when 'slides' then a.kind = 'document'
                when 'resource' then a.kind in ('document', 'audio', 'image')
                else false end) then
        raise exception '"%" can''t be attached as %.', a.title, coalesce(v_role, 'that') using errcode = '22023';
      end if;
      insert into media.item_media (item_id, asset_id, role, label, members_only, sort_order)
      values (i.id, a.id, v_role, nullif(btrim(v_att ->> 'label'), ''), coalesce((v_att ->> 'members_only')::boolean, false),
              coalesce((v_att ->> 'sort_order')::integer, 0))
      on conflict (item_id, asset_id, role) do nothing;
    end loop;
  end if;

  perform media.audit(case when v_new then 'media.item_created' else 'media.item_updated' end, 'media_item', i.id,
                      jsonb_build_object('kind', i.kind, 'fields', v_fields));
  return jsonb_build_object('id', i.id, 'created', v_new, 'state', media.item_state(i));
end;
$$;

-- Publishing (content.publish only). Actions:
--   publish     go live at p_publish_at (now when null; scheduled when later)
--   unpublish   back to draft
--   archive     hidden everywhere, kept for the record
--   restore     archived → draft
--   expiry      set or clear the expiry time
create function public.media_admin_item_status(p_id uuid, p_action text, p_publish_at timestamptz, p_expires_at timestamptz, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.publish');
  i media.items;
  v_missing text;
  v_at timestamptz;
begin
  select * into i from media.items where id = p_id for update;
  if i.id is null then
    raise exception 'Content not found.' using errcode = 'P0002';
  end if;
  if p_action = 'publish' then
    if i.status = 'archived' then
      raise exception 'Restore this item before publishing it.' using errcode = '22023';
    end if;
    if char_length(btrim(i.title)) < 3 or i.title = 'Untitled' then
      raise exception 'Give it a title before publishing.' using errcode = '22023';
    end if;
    if i.audience = 'public' and coalesce(p_confirm, '') <> 'public' then
      raise exception 'Confirm that this will be visible to anyone, including people who are not signed in.' using errcode = '22023';
    end if;
    if i.kind = 'episode' and not exists (select 1 from media.item_media where item_id = i.id and role = 'audio') then
      raise exception 'Attach the episode''s audio before publishing.' using errcode = '22023';
    end if;
    select string_agg(a.title, ', ' order by a.title) into v_missing
      from media.item_media im join media.assets a on a.id = im.asset_id
     where im.item_id = i.id and (a.status <> 'ready'
                                  or (a.kind in ('audio', 'video', 'document') and (a.rights = 'unknown' or a.rights_confirmed_at is null)));
    if v_missing is not null then
      raise exception 'Confirm the source and permission for church-hosted files before publishing: %.', v_missing using errcode = '22023';
    end if;
    if not media.thread_fits(i.discussion_thread_id, i.audience, i.group_id) then
      raise exception 'The linked discussion would reach people outside this content''s audience.' using errcode = '22023';
    end if;
    v_at := coalesce(p_publish_at, now());
    if p_expires_at is not null and p_expires_at <= v_at then
      raise exception 'The expiry time must be after the publish time.' using errcode = '22023';
    end if;
    update media.items
       set status = case when v_at > now() then 'scheduled'::media.pub_status else 'published'::media.pub_status end,
           publish_at = v_at, expires_at = p_expires_at,
           first_published_at = coalesce(first_published_at, v_at),
           updated_by = v_uid, updated_at = now()
     where id = i.id
    returning * into i;
  elsif p_action = 'unpublish' then
    update media.items set status = 'draft', updated_by = v_uid, updated_at = now() where id = i.id returning * into i;
  elsif p_action = 'archive' then
    update media.items set status = 'archived', archived_at = now(), featured = false, book_current = false,
                           updated_by = v_uid, updated_at = now()
     where id = i.id returning * into i;
  elsif p_action = 'restore' then
    update media.items set status = 'draft', archived_at = null, updated_by = v_uid, updated_at = now()
     where id = i.id and status = 'archived' returning * into i;
  elsif p_action = 'expiry' then
    if p_expires_at is not null and i.publish_at is not null and p_expires_at <= i.publish_at then
      raise exception 'The expiry time must be after the publish time.' using errcode = '22023';
    end if;
    update media.items set expires_at = p_expires_at, updated_by = v_uid, updated_at = now() where id = i.id returning * into i;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform media.audit('media.item_' || p_action, 'media_item', i.id,
                      jsonb_build_object('kind', i.kind, 'state', media.item_state(i), 'audience', i.audience));
  return jsonb_build_object('id', i.id, 'state', media.item_state(i));
end;
$$;

-- Deletes a draft that was never published (otherwise archive it).
create function public.media_admin_item_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  i media.items;
begin
  select * into i from media.items where id = p_id for update;
  if i.id is null then
    raise exception 'Content not found.' using errcode = 'P0002';
  end if;
  if i.status <> 'draft' or i.first_published_at is not null then
    raise exception 'Only drafts that were never published can be deleted. Archive it instead.' using errcode = '22023';
  end if;
  if i.created_by is distinct from v_uid and not public.has_capability('content.publish') then
    raise exception 'Only the author or a publisher can delete this draft.' using errcode = '42501';
  end if;
  if exists (select 1 from media.items x where x.book_id = i.id) then
    raise exception 'This book has assignments. Remove them first.' using errcode = '22023';
  end if;
  delete from media.items where id = i.id;
  perform media.audit('media.item_deleted', 'media_item', i.id, jsonb_build_object('kind', i.kind));
end;
$$;

-- Devotional scheduling calendar.
create function public.media_admin_calendar(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform media.require_manager();
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a range of up to two months.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'date', i.devotional_on, 'state', media.item_state(i),
                                                       'audience', i.audience, 'publish_at', i.publish_at)
                                    order by i.devotional_on, i.sort_order)
                     from media.items i
                    where i.kind = 'devotional' and i.devotional_on between p_from and p_to and i.status <> 'archived'), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Member reading (visitors see public content only)
-- ---------------------------------------------------------------------------
-- Filters: q, series_id, topic_id, person_id, book (scripture book name),
-- from/to (date of the kind), featured, show_id, book_id, current.
create function media.matches(i media.items, f jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (nullif(f ->> 'q', '') is null
          or i.title ilike media.like_pattern(f ->> 'q') or i.summary ilike media.like_pattern(f ->> 'q')
          or exists (select 1 from unnest(i.tags) t where t ilike media.like_pattern(f ->> 'q'))
          or exists (select 1 from unnest(i.scripture_refs) r where r ilike media.like_pattern(f ->> 'q'))
          or exists (select 1 from media.item_people ip join media.people pp on pp.id = ip.person_id
                      where ip.item_id = i.id and pp.name ilike media.like_pattern(f ->> 'q')))
     and (nullif(f ->> 'series_id', '') is null or i.series_id = (f ->> 'series_id')::uuid)
     and (nullif(f ->> 'topic_id', '') is null or exists (select 1 from media.item_topics it where it.item_id = i.id and it.topic_id = (f ->> 'topic_id')::uuid))
     and (nullif(f ->> 'person_id', '') is null or exists (select 1 from media.item_people ip where ip.item_id = i.id and ip.person_id = (f ->> 'person_id')::uuid))
     and (nullif(f ->> 'book', '') is null or exists (select 1 from unnest(i.scripture_refs) r where r = f ->> 'book' or r like (f ->> 'book') || ' %'))
     and (nullif(f ->> 'from', '') is null or coalesce(i.devotional_on, i.delivered_on, i.starts_on, (i.publish_at at time zone 'UTC')::date) >= (f ->> 'from')::date)
     and (nullif(f ->> 'to', '') is null or coalesce(i.devotional_on, i.delivered_on, i.starts_on, (i.publish_at at time zone 'UTC')::date) <= (f ->> 'to')::date)
     and (nullif(f ->> 'featured', '') is null or i.featured = (f ->> 'featured')::boolean)
     and (nullif(f ->> 'show_id', '') is null or i.show_id = (f ->> 'show_id')::uuid)
     and (nullif(f ->> 'book_id', '') is null or i.book_id = (f ->> 'book_id')::uuid)
     and (nullif(f ->> 'current', '') is null or i.book_current = (f ->> 'current')::boolean);
$$;

create function media.sort_key(i media.items)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(i.devotional_on::timestamptz, i.delivered_on::timestamptz, i.starts_on::timestamptz, i.publish_at);
$$;

create function public.media_items(p_kind text, p_filters jsonb, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  return (
    with f as (
      select i.* from media.items i
       where i.kind::text = p_kind and media.item_visible(i, v_uid) and media.matches(i, v_f))
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(media.item_card(x, v_uid) order by x.book_current desc, media.sort_key(x) desc nulls last, x.sort_order, x.id)
                           from (select * from f order by f.book_current desc, media.sort_key(f) desc nulls last, f.sort_order, f.id
                                  limit v_limit offset v_offset) x), '[]'::jsonb),
      'total', (select count(*) from f)));
end;
$$;

create function public.media_item(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  i media.items;
begin
  select * into i from media.items where id = p_id;
  if i.id is null or not media.item_visible(i, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return media.item_detail(i, v_uid);
end;
$$;

-- Today's devotional in the church time zone (none is fine), with the
-- previous and next dates that have one, and recent entries.
create function public.media_devotional_day(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := media.church_today();
  v_date date := coalesce(p_date, v_today);
  i media.items;
begin
  if v_date > v_today then
    v_date := v_today;
  end if;
  select * into i from media.items x
   where x.kind = 'devotional' and x.devotional_on = v_date and media.item_visible(x, v_uid)
   order by x.sort_order, x.publish_at desc limit 1;
  return jsonb_build_object(
    'today', v_today,
    'date', v_date,
    'item', case when i.id is not null then media.item_detail(i, v_uid) end,
    'others', coalesce((select jsonb_agg(media.item_card(x, v_uid) order by x.sort_order)
                          from media.items x
                         where x.kind = 'devotional' and x.devotional_on = v_date and x.id is distinct from i.id
                           and media.item_visible(x, v_uid)), '[]'::jsonb),
    'previous', (select max(x.devotional_on) from media.items x
                  where x.kind = 'devotional' and x.devotional_on < v_date and media.item_visible(x, v_uid)),
    'next', (select min(x.devotional_on) from media.items x
              where x.kind = 'devotional' and x.devotional_on > v_date and x.devotional_on <= v_today and media.item_visible(x, v_uid)));
end;
$$;

create function public.media_series(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s media.series;
  v_items jsonb;
begin
  select * into s from media.series where id = p_id and not archived;
  if s.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select jsonb_agg(media.item_card(i, v_uid) order by media.sort_key(i) desc nulls last) into v_items
    from media.items i where i.series_id = s.id and media.item_visible(i, v_uid);
  if v_items is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description, 'scope', s.scope,
    'cover', (select jsonb_build_object('asset_id', a.id, 'path', a.path, 'variant_path', a.variant_path, 'alt', coalesce(a.alt_text, ''))
                from media.assets a where a.id = s.cover_asset_id and a.status = 'ready' and (a.public_ok or media.is_member(v_uid))),
    'items', v_items);
end;
$$;

-- Filters for the lesson archive: series, speakers, topics, and scripture
-- books that appear in content the caller can see.
create function public.media_facets(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  return (
    with v as (select i.* from media.items i where i.kind::text = p_kind and media.item_visible(i, v_uid))
    select jsonb_build_object(
      'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.title)
                            from media.series s where not s.archived and exists (select 1 from v where v.series_id = s.id)), '[]'::jsonb),
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name)
                            from media.people p where exists (select 1 from media.item_people ip join v on v.id = ip.item_id where ip.person_id = p.id)), '[]'::jsonb),
      'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                            from media.topics t where exists (select 1 from media.item_topics it join v on v.id = it.item_id where it.topic_id = t.id)), '[]'::jsonb),
      'refs', coalesce((select jsonb_agg(distinct r) from v, unnest(v.scripture_refs) r), '[]'::jsonb)));
end;
$$;

-- Church reading: the current book(s), current and recent assignments, and
-- past books.
create function public.media_reading()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := media.church_today();
begin
  return jsonb_build_object(
    'today', v_today,
    'current_books', coalesce((select jsonb_agg(media.item_card(b, v_uid) order by b.sort_order, b.publish_at desc)
                                 from media.items b where b.kind = 'book' and b.book_current and media.item_visible(b, v_uid)), '[]'::jsonb),
    'current_assignments', coalesce((select jsonb_agg(media.item_card(x, v_uid) order by x.starts_on desc)
                                       from media.items x
                                      where x.kind = 'assignment' and x.starts_on <= v_today and (x.ends_on is null or x.ends_on >= v_today)
                                        and media.item_visible(x, v_uid)), '[]'::jsonb),
    'recent_assignments', coalesce((select jsonb_agg(c order by (c ->> 'starts_on') desc)
                                      from (select media.item_card(x, v_uid) c from media.items x
                                             where x.kind = 'assignment' and (x.starts_on > v_today or x.ends_on < v_today)
                                               and media.item_visible(x, v_uid)
                                             order by x.starts_on desc limit 12) y), '[]'::jsonb),
    'past_books', coalesce((select jsonb_agg(media.item_card(b, v_uid) order by b.publish_at desc)
                              from media.items b where b.kind = 'book' and not b.book_current and media.item_visible(b, v_uid)), '[]'::jsonb));
end;
$$;

-- What the home page shows: today's devotional, the latest lesson, a
-- featured podcast, and the current reading assignment. Each is null when
-- nothing has been published (the page then shows nothing for it).
create function public.media_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := media.church_today();
begin
  return jsonb_build_object(
    'devotional', (select media.item_card(x, v_uid) from media.items x
                    where x.kind = 'devotional' and x.devotional_on = v_today and media.item_visible(x, v_uid)
                    order by x.sort_order, x.publish_at desc limit 1),
    'lesson', (select media.item_card(x, v_uid) from media.items x
                where x.kind = 'lesson' and media.item_visible(x, v_uid)
                order by x.delivered_on desc, x.publish_at desc limit 1),
    'show', (select jsonb_build_object('id', s.id, 'title', s.title, 'kind', s.kind, 'author', s.author,
                                       'artwork_url', s.artwork_url,
                                       'artwork', (select jsonb_build_object('path', a.path, 'variant_path', a.variant_path)
                                                     from media.assets a where a.id = s.artwork_asset_id and a.status = 'ready'
                                                       and (s.audience <> 'public' or a.public_ok or media.is_member(v_uid))))
               from media.shows s where s.featured and media.show_visible(s, v_uid)
               order by s.sort_order, s.title limit 1),
    'assignment', (select media.item_card(x, v_uid) from media.items x
                    where x.kind = 'assignment' and x.starts_on <= v_today and (x.ends_on is null or x.ends_on >= v_today)
                      and media.item_visible(x, v_uid)
                    order by x.starts_on desc limit 1));
end;
$$;

-- ---------------------------------------------------------------------------
-- Bookmarks, progress, completions (private to their owner)
-- ---------------------------------------------------------------------------
create function public.media_bookmark(p_type text, p_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if p_on then
    if not (case p_type
              when 'item' then media.item_visible_id(p_id, v_uid)
              when 'show' then exists (select 1 from media.shows s where s.id = p_id and media.show_visible(s, v_uid))
              else false end) then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
    perform community.rate_limit(v_uid, 'media.bookmark', 120, interval '10 minutes');
    insert into media.bookmarks (profile_id, target_type, target_id) values (v_uid, p_type, p_id) on conflict do nothing;
  else
    delete from media.bookmarks where profile_id = v_uid and target_type = p_type and target_id = p_id;
  end if;
  return p_on;
end;
$$;

-- Only bookmarks the member can still see are returned.
create function public.media_bookmarks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(media.item_card(i, v_uid) order by b.created_at desc)
                         from media.bookmarks b join media.items i on i.id = b.target_id
                        where b.profile_id = v_uid and b.target_type = 'item' and media.item_visible(i, v_uid)), '[]'::jsonb),
    'shows', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'kind', s.kind, 'author', s.author) order by b.created_at desc)
                         from media.bookmarks b join media.shows s on s.id = b.target_id
                        where b.profile_id = v_uid and b.target_type = 'show' and media.show_visible(s, v_uid)), '[]'::jsonb));
end;
$$;

-- Whether the caller may play this media key right now.
create function media.key_playable(p_key text, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case left(p_key, 2)
    when 'a:' then media.asset_visible(substr(p_key, 3)::uuid, p_profile)
    when 'e:' then exists (select 1 from media.external_episodes e join media.shows s on s.id = e.show_id
                            where e.id = substr(p_key, 3)::uuid and e.missing_since is null and s.allow_stream
                              and media.show_visible(s, p_profile))
    else false end;
$$;

create function public.media_progress_save(p_key text, p_item uuid, p_position numeric, p_duration numeric, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if p_key !~ '^[ae]:[0-9a-f-]{36}$' or not media.key_playable(p_key, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  insert into media.progress (profile_id, media_key, item_id, position_seconds, duration_seconds, completed, updated_at)
  values (v_uid, p_key, case when p_item is not null and media.item_visible_id(p_item, v_uid) then p_item end,
          greatest(0, least(coalesce(p_position, 0), 86400)),
          case when p_duration > 0 and p_duration <= 86400 then p_duration end, coalesce(p_completed, false), now())
  on conflict (profile_id, media_key) do update
    set position_seconds = excluded.position_seconds,
        duration_seconds = coalesce(excluded.duration_seconds, media.progress.duration_seconds),
        item_id = coalesce(excluded.item_id, media.progress.item_id),
        completed = excluded.completed or (media.progress.completed and excluded.position_seconds = 0),
        updated_at = now();
end;
$$;

create function public.media_progress(p_keys text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  return coalesce((select jsonb_object_agg(p.media_key, jsonb_build_object('position', p.position_seconds, 'duration', p.duration_seconds,
                                                                           'completed', p.completed))
                     from media.progress p
                    where p.profile_id = v_uid and p.media_key = any (coalesce(p_keys, '{}')) and media.key_playable(p.media_key, v_uid)), '{}'::jsonb);
end;
$$;

-- "Continue listening": the member's own unfinished items they can still see.
create function public.media_continue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  return coalesce((select jsonb_agg(media.item_card(i, v_uid) || jsonb_build_object('position', p.position_seconds, 'duration', p.duration_seconds)
                                    order by p.updated_at desc)
                     from (select * from media.progress p
                            where p.profile_id = v_uid and not p.completed and p.item_id is not null and p.position_seconds > 5
                            order by p.updated_at desc limit 6) p
                     join media.items i on i.id = p.item_id
                    where media.item_visible(i, v_uid) and media.key_playable(p.media_key, v_uid)), '[]'::jsonb);
end;
$$;

create function public.media_progress_clear()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  delete from media.progress where profile_id = v_uid;
end;
$$;

create function public.media_assignment_complete(p_item uuid, p_done boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if not exists (select 1 from media.items i where i.id = p_item and i.kind = 'assignment' and media.item_visible(i, v_uid)) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_done then
    insert into media.completions (profile_id, item_id) values (v_uid, p_item) on conflict do nothing;
  else
    delete from media.completions where profile_id = v_uid and item_id = p_item;
  end if;
  return p_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- Playback and downloads: the storage path of a file the caller may use.
-- The app then signs a short-lived URL (Storage RLS checks again).
-- ---------------------------------------------------------------------------
create function public.media_file(p_asset uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a media.assets;
begin
  select * into a from media.assets where id = p_asset and status = 'ready' and kind <> 'external_video';
  if a.id is null or not (media.asset_visible(a.id, v_uid) or (v_uid is not null and media.is_manager())) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('path', a.path, 'mime', a.mime, 'kind', a.kind, 'title', a.title, 'size_bytes', a.size_bytes,
                            'original_name', a.original_name);
end;
$$;

create function public.media_transcript(p_asset uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a media.assets;
begin
  select * into a from media.assets where id = p_asset and status = 'ready';
  if a.id is null or not (media.asset_visible(a.id, v_uid) or (v_uid is not null and media.is_manager())) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return coalesce(a.transcript, '');
end;
$$;

-- ---------------------------------------------------------------------------
-- New-content notice preferences (which kinds the member wants to hear about)
-- ---------------------------------------------------------------------------
create function public.media_prefs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  return jsonb_build_object('muted', coalesce((select to_jsonb(muted_kinds) from media.member_prefs where profile_id = v_uid), '[]'::jsonb));
end;
$$;

create function public.media_prefs_save(p_muted text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  insert into media.member_prefs (profile_id, muted_kinds, updated_at)
  values (v_uid, array(select distinct k from unnest(coalesce(p_muted, '{}')) k), now())
  on conflict (profile_id) do update set muted_kinds = excluded.muted_kinds, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema media from public, anon, authenticated;
revoke execute on function
  public.media_admin_items(text, text, text, integer, integer), public.media_admin_item(uuid), public.media_admin_item_options(),
  public.media_admin_item_save(uuid, jsonb, uuid), public.media_admin_item_status(uuid, text, timestamptz, timestamptz, text),
  public.media_admin_item_delete(uuid), public.media_admin_calendar(date, date),
  public.media_items(text, jsonb, integer, integer), public.media_item(uuid), public.media_devotional_day(date),
  public.media_series(uuid), public.media_facets(text), public.media_reading(), public.media_home(),
  public.media_bookmark(text, uuid, boolean), public.media_bookmarks(), public.media_progress_save(text, uuid, numeric, numeric, boolean),
  public.media_progress(text[]), public.media_continue(), public.media_progress_clear(), public.media_assignment_complete(uuid, boolean),
  public.media_file(uuid), public.media_transcript(uuid), public.media_prefs(), public.media_prefs_save(text[])
from public;

-- Public teaching content is readable by visitors.
grant execute on function
  public.media_items(text, jsonb, integer, integer), public.media_item(uuid), public.media_devotional_day(date),
  public.media_series(uuid), public.media_facets(text), public.media_file(uuid), public.media_transcript(uuid)
to anon, authenticated;

grant execute on function
  public.media_admin_items(text, text, text, integer, integer), public.media_admin_item(uuid), public.media_admin_item_options(),
  public.media_admin_item_save(uuid, jsonb, uuid), public.media_admin_item_status(uuid, text, timestamptz, timestamptz, text),
  public.media_admin_item_delete(uuid), public.media_admin_calendar(date, date),
  public.media_reading(), public.media_home(),
  public.media_bookmark(text, uuid, boolean), public.media_bookmarks(), public.media_progress_save(text, uuid, numeric, numeric, boolean),
  public.media_progress(text[]), public.media_continue(), public.media_progress_clear(), public.media_assignment_complete(uuid, boolean),
  public.media_prefs(), public.media_prefs_save(text[])
to authenticated;
