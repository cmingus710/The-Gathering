-- Phase 5 · Community: discussions, groups, and group-restricted events.
--
-- Discussions
--   * Church-wide threads (in a category) are readable by approved adult
--     members; group threads only by that group's active members. Nothing is
--     publicly readable.
--   * Posting needs the current guidelines acknowledged and no posting
--     restriction. Locked threads take no replies or edits.
--   * Author deletion: a thread or reply with no replies is removed. A thread
--     with replies keeps its place as a "deleted" placeholder whose title and
--     body are erased in the same statement (a constraint enforces it); a
--     deleted reply becomes a placeholder too. Removed text is not kept
--     anywhere except a report snapshot taken before deletion.
--   * Moderator hiding keeps the text (so it can be restored) but returns it
--     only to people who can moderate that thread.
--   * Edits overwrite the text; only "edited" and its time are kept.
-- Groups
--   * Discoverable groups: any approved member sees name, summary, and image,
--     and can ask to join. Hidden groups: only members and community.manage
--     holders know they exist. Description details ("about"), the roster,
--     discussions, and group events are for active members only.
--   * Membership comes only from accepted invitations, approved requests, or
--     an administrator's appointment. Never from households or interests.
--   * Leaving or removal is immediate: discussions, roster, events, event
--     images, feeds, and notifications all recheck membership on every read,
--     and group event registrations are canceled (Phase 4 reservation
--     policy: canceled as "ineligible", no email, waitlist promoted).

-- ---------------------------------------------------------------------------
-- Guidelines
-- ---------------------------------------------------------------------------
create function public.community_guidelines()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  return (select jsonb_build_object('text', s.guidelines, 'version', s.guidelines_version,
                                    'acked', community.has_acked(v_uid),
                                    'posting_restricted', community.restricted(v_uid, 'posting'),
                                    'messaging_restricted', community.restricted(v_uid, 'messaging'),
                                    'restriction', (select jsonb_build_object('scope', r.scope, 'reason', r.reason, 'ends_at', r.ends_at)
                                                      from community.restrictions r
                                                     where r.profile_id = v_uid and r.lifted_at is null and r.starts_at <= now()
                                                       and (r.ends_at is null or r.ends_at > now())
                                                     order by r.created_at desc limit 1))
            from community.settings s);
end;
$$;

create function public.community_ack_guidelines(p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if p_version is distinct from (select guidelines_version from community.settings) then
    raise exception 'The guidelines were just updated. Please read the new version.' using errcode = '22023';
  end if;
  insert into community.guideline_acks (profile_id, version) values (v_uid, p_version) on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------
create function community.reactions_json(p_type text, p_id uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_object_agg(k, jsonb_build_object(
           'count', (select count(*) from community.reactions r where r.target_type = p_type and r.target_id = p_id and r.kind = k),
           'mine', exists (select 1 from community.reactions r where r.target_type = p_type and r.target_id = p_id
                            and r.kind = k and r.profile_id = p_viewer)))
    from unnest(array['heart', 'pray', 'amen']) k;
$$;

create function community.thread_card(t community.threads, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'title', case when t.status = 'visible' then t.title end,
    'excerpt', case when t.status = 'visible' then left(regexp_replace(t.body, '\s+', ' ', 'g'), 180) end,
    'status', t.status,
    'author', case when t.status = 'visible' and t.author_id is not null then community.display_name(t.author_id) end,
    'mine', t.author_id = p_viewer,
    'category', case when t.category_id is null then null
                     else (select jsonb_build_object('id', c.id, 'name', c.name) from community.categories c where c.id = t.category_id) end,
    'group', case when t.group_id is null then null
                  else (select jsonb_build_object('id', g.id, 'name', g.name) from community.groups g where g.id = t.group_id) end,
    'pinned', t.pinned, 'locked', t.locked,
    'reply_count', t.reply_count,
    'created_at', t.created_at, 'last_activity_at', t.last_activity_at,
    'following', exists (select 1 from community.follows f where f.thread_id = t.id and f.profile_id = p_viewer));
$$;

create function community.post_json(p community.posts, p_viewer uuid, p_can_moderate boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'status', p.status,
    'body', case when p.status = 'visible' or (p.status = 'hidden' and p_can_moderate) then p.body end,
    'author', case when p.status <> 'deleted' and p.author_id is not null then community.display_name(p.author_id) end,
    'author_id', case when p.status <> 'deleted' then p.author_id end,
    'mine', p.author_id = p_viewer,
    'created_at', p.created_at, 'edited_at', p.edited_at,
    'reactions', case when p.status = 'visible' then community.reactions_json('post', p.id, p_viewer) end);
$$;

-- ---------------------------------------------------------------------------
-- Reading discussions
-- ---------------------------------------------------------------------------
create function public.community_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'name', c.name, 'description', c.description,
             'threads', (select count(*) from community.threads t where t.category_id = c.id and t.status <> 'hidden'),
             'last_activity_at', (select max(t.last_activity_at) from community.threads t where t.category_id = c.id and t.status = 'visible'))
           order by c.sort_order, c.name)
      from community.categories c where c.active), '[]'::jsonb);
end;
$$;

-- Thread list for a category or a group, newest activity first. The first
-- page starts with pinned threads; later pages use the (last_activity_at,
-- id) cursor over unpinned threads. Hidden threads are listed only for
-- people who can moderate them; deleted placeholders only while replies exist.
create function public.community_threads(
  p_category uuid default null, p_group uuid default null,
  p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_mod boolean;
  v_items jsonb;
  v_pinned jsonb := '[]'::jsonb;
  v_last record;
begin
  if (p_category is null) = (p_group is null) then
    raise exception 'Choose a category or a group.' using errcode = '22023';
  end if;
  if p_group is not null and not community.group_member(p_group, v_uid) then
    raise exception 'That group''s discussions are only for its members.' using errcode = '42501';
  end if;
  if p_category is not null and not exists (select 1 from community.categories where id = p_category and active) then
    raise exception 'That category wasn''t found.' using errcode = 'P0002';
  end if;
  v_mod := (select public.has_capability('community.moderate'))
           or (p_group is not null and community.group_leader(p_group, v_uid));

  if p_cursor_at is null then
    select coalesce(jsonb_agg(community.thread_card(t, v_uid) order by t.last_activity_at desc, t.id), '[]'::jsonb)
      into v_pinned
      from community.threads t
     where t.pinned and (t.category_id = p_category or t.group_id = p_group)
       and (t.status = 'visible' or (t.status = 'hidden' and v_mod) or (t.status = 'deleted' and t.reply_count > 0));
  end if;

  select coalesce(jsonb_agg(community.thread_card(x, v_uid) order by x.last_activity_at desc, x.id), '[]'::jsonb)
    into v_items
    from (select t.* from community.threads t
           where not t.pinned and (t.category_id = p_category or t.group_id = p_group)
             and (t.status = 'visible' or (t.status = 'hidden' and v_mod) or (t.status = 'deleted' and t.reply_count > 0))
             and (p_cursor_at is null or (t.last_activity_at, t.id) < (p_cursor_at, p_cursor_id))
           order by t.last_activity_at desc, t.id desc
           limit v_limit) x;

  return jsonb_build_object(
    'pinned', v_pinned,
    'items', v_items,
    'next_cursor', case when jsonb_array_length(v_items) = v_limit
                        then jsonb_build_object('at', v_items -> (v_limit - 1) ->> 'last_activity_at',
                                                'id', v_items -> (v_limit - 1) ->> 'id') end);
end;
$$;

-- Recent church-wide activity plus the caller's groups, for the hub page.
create function public.community_recent(p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  return coalesce((
    select jsonb_agg(community.thread_card(x, v_uid) order by x.last_activity_at desc)
      from (select t.* from community.threads t
             where t.status = 'visible'
               and (t.group_id is null or community.group_member(t.group_id, v_uid))
             order by t.last_activity_at desc
             limit least(greatest(coalesce(p_limit, 10), 1), 30)) x), '[]'::jsonb);
end;
$$;

-- One thread with a page of replies (oldest first; p_after_* continues).
-- Null when it doesn't exist or the caller can't read it.
create function public.community_thread(p_id uuid, p_after_at timestamptz default null, p_after_id uuid default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  t community.threads;
  v_mod boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_posts jsonb;
  v_group_status text := 'active';
begin
  select * into t from community.threads where id = p_id;
  if not found or not community.can_read_thread(t.id, v_uid) then
    return null;
  end if;
  v_mod := community.can_moderate_thread(t.id);
  if t.status = 'hidden' and not v_mod then
    return null;
  end if;
  if t.group_id is not null then
    select g.status::text into v_group_status from community.groups g where g.id = t.group_id;
  end if;
  select coalesce(jsonb_agg(community.post_json(x, v_uid, v_mod) order by x.created_at, x.id), '[]'::jsonb)
    into v_posts
    from (select p.* from community.posts p
           where p.thread_id = t.id
             and (p_after_at is null or (p.created_at, p.id) > (p_after_at, p_after_id))
           order by p.created_at, p.id
           limit v_limit) x;
  return community.thread_card(t, v_uid) || jsonb_build_object(
    'title', case when t.status = 'visible' or (t.status = 'hidden' and v_mod) then t.title end,
    'body', case when t.status = 'visible' or (t.status = 'hidden' and v_mod) then t.body end,
    'author', case when t.status <> 'deleted' and t.author_id is not null then community.display_name(t.author_id) end,
    'edited_at', t.edited_at,
    'audience', case when t.group_id is null then 'church' else 'group' end,
    'group_archived', v_group_status = 'archived',
    'reactions', case when t.status = 'visible' then community.reactions_json('thread', t.id, v_uid) end,
    'posts', v_posts,
    'has_more', jsonb_array_length(v_posts) = v_limit,
    'can_moderate', v_mod,
    'can_reply', t.status = 'visible' and not t.locked and v_group_status = 'active'
                 and community.has_acked(v_uid) and not community.restricted(v_uid, 'posting'),
    'muted', exists (select 1 from community.mutes m where m.profile_id = v_uid and m.target_type = 'thread' and m.target_id = t.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing discussions
-- ---------------------------------------------------------------------------
create function community.clean_text(p text, p_min integer, p_max integer, p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p, ''));
begin
  -- Strip control characters other than tab and newline.
  v := regexp_replace(v, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  if char_length(v) < p_min then
    raise exception '% is too short.', p_label using errcode = '22023';
  end if;
  if char_length(v) > p_max then
    raise exception '% must be % characters or fewer.', p_label, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

create function public.community_thread_create(p_category uuid, p_group uuid, p_title text, p_body text, p_client_key uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_poster();
  v_id uuid;
  v_title text := community.clean_text(p_title, 3, 160, 'The title');
  v_body text := community.clean_text(p_body, 1, 10000, 'The message');
begin
  if (p_category is null) = (p_group is null) then
    raise exception 'Choose where to post.' using errcode = '22023';
  end if;
  if p_client_key is not null then
    select id into v_id from community.threads where author_id = v_uid and client_key = p_client_key;
    if found then
      return v_id;
    end if;
  end if;
  if p_category is not null and not exists (select 1 from community.categories where id = p_category and active) then
    raise exception 'That category isn''t available.' using errcode = '22023';
  end if;
  if p_group is not null and not (community.group_member(p_group, v_uid)
                                  and exists (select 1 from community.groups where id = p_group and status = 'active')) then
    raise exception 'Only members of an active group can post there.' using errcode = '42501';
  end if;
  perform community.rate_limit(v_uid, 'thread', 6, interval '1 hour');
  insert into community.threads (category_id, group_id, author_id, title, body, client_key)
  values (p_category, p_group, v_uid, v_title, v_body, p_client_key)
  returning id into v_id;
  insert into community.follows (thread_id, profile_id) values (v_id, v_uid) on conflict do nothing;
  return v_id;
end;
$$;

create function public.community_thread_edit(p_id uuid, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_poster();
  t community.threads;
begin
  select * into t from community.threads where id = p_id for update;
  if not found or t.author_id is distinct from v_uid or not community.can_read_thread(t.id, v_uid) then
    raise exception 'That discussion wasn''t found.' using errcode = 'P0002';
  end if;
  if t.status <> 'visible' then
    raise exception 'This discussion can''t be edited.' using errcode = '22023';
  end if;
  if t.locked then
    raise exception 'This discussion is locked.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'edit', 30, interval '15 minutes');
  update community.threads
     set title = community.clean_text(p_title, 3, 160, 'The title'),
         body = community.clean_text(p_body, 1, 10000, 'The message'),
         edited_at = now()
   where id = t.id;
end;
$$;

-- Author deletion (see header). Works even when locked or restricted, so
-- people can always remove what they wrote.
create function public.community_thread_delete(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  t community.threads;
begin
  select * into t from community.threads where id = p_id for update;
  if not found or t.author_id is distinct from v_uid or t.status = 'deleted' then
    raise exception 'That discussion wasn''t found.' using errcode = 'P0002';
  end if;
  delete from community.reactions where target_type = 'thread' and target_id = t.id;
  if exists (select 1 from community.posts where thread_id = t.id) then
    update community.threads
       set status = 'deleted', title = '', body = '', deleted_at = now(), pinned = false
     where id = t.id;
    return 'placeholder';
  end if;
  delete from community.threads where id = t.id;
  return 'removed';
end;
$$;

create function public.community_reply(p_thread uuid, p_body text, p_client_key uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_poster();
  t community.threads;
  v_id uuid;
  v_body text := community.clean_text(p_body, 1, 5000, 'Your reply');
  v_f uuid;
begin
  -- Lock the thread so lock/hide/delete and replies are serialized.
  select * into t from community.threads where id = p_thread for update;
  if not found or not community.can_read_thread(t.id, v_uid) or t.status = 'hidden' then
    raise exception 'That discussion wasn''t found.' using errcode = 'P0002';
  end if;
  if p_client_key is not null then
    select id into v_id from community.posts where thread_id = t.id and author_id = v_uid and client_key = p_client_key;
    if found then
      return v_id;
    end if;
  end if;
  if t.status <> 'visible' then
    raise exception 'This discussion was deleted, so it can''t take new replies.' using errcode = '22023';
  end if;
  if t.locked then
    raise exception 'This discussion is locked, so it can''t take new replies.' using errcode = '22023';
  end if;
  if t.group_id is not null and exists (select 1 from community.groups where id = t.group_id and status = 'archived') then
    raise exception 'This group is archived, so its discussions are read-only.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'reply', 30, interval '15 minutes');
  insert into community.posts (thread_id, author_id, body, client_key) values (t.id, v_uid, v_body, p_client_key)
  returning id into v_id;
  update community.threads set reply_count = reply_count + 1, last_activity_at = now() where id = t.id;
  insert into community.follows (thread_id, profile_id) values (t.id, v_uid) on conflict do nothing;

  -- Notifications (merged per thread while unread). Access is rechecked
  -- again whenever they are read or delivered.
  if t.author_id is not null and t.author_id <> v_uid then
    perform community.notify(t.author_id, 'reply_mine', v_uid,
      jsonb_build_object('thread_id', t.id, 'post_id', v_id), 'thread:' || t.id);
  end if;
  for v_f in
    select f.profile_id from community.follows f
     where f.thread_id = t.id and f.profile_id <> v_uid and f.profile_id is distinct from t.author_id
       and community.can_read_thread(t.id, f.profile_id)
  loop
    perform community.notify(v_f, 'reply_followed', v_uid,
      jsonb_build_object('thread_id', t.id, 'post_id', v_id), 'thread:' || t.id);
  end loop;
  return v_id;
end;
$$;

create function public.community_reply_edit(p_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_poster();
  p community.posts;
  t community.threads;
begin
  select * into p from community.posts where id = p_id for update;
  if not found or p.author_id is distinct from v_uid or not community.can_read_thread(p.thread_id, v_uid) then
    raise exception 'That reply wasn''t found.' using errcode = 'P0002';
  end if;
  select * into t from community.threads where id = p.thread_id;
  if p.status <> 'visible' or t.status = 'hidden' then
    raise exception 'This reply can''t be edited.' using errcode = '22023';
  end if;
  if t.locked then
    raise exception 'This discussion is locked.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'edit', 30, interval '15 minutes');
  update community.posts set body = community.clean_text(p_body, 1, 5000, 'Your reply'), edited_at = now() where id = p.id;
end;
$$;

create function public.community_reply_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  p community.posts;
begin
  select * into p from community.posts where id = p_id for update;
  if not found or p.author_id is distinct from v_uid or p.status = 'deleted' then
    raise exception 'That reply wasn''t found.' using errcode = 'P0002';
  end if;
  delete from community.reactions where target_type = 'post' and target_id = p.id;
  update community.posts set status = 'deleted', body = '', deleted_at = now() where id = p.id;
end;
$$;

create function public.community_react(p_type text, p_id uuid, p_kind text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_poster();
  v_thread uuid;
  v_ok boolean;
begin
  if p_type = 'thread' then
    select id, status = 'visible' into v_thread, v_ok from community.threads where id = p_id;
  elsif p_type = 'post' then
    select p.thread_id, p.status = 'visible' and t.status = 'visible' into v_thread, v_ok
      from community.posts p join community.threads t on t.id = p.thread_id where p.id = p_id;
  end if;
  if v_thread is null or not coalesce(v_ok, false) or not community.can_read_thread(v_thread, v_uid) then
    raise exception 'That wasn''t found.' using errcode = 'P0002';
  end if;
  if p_kind not in ('heart', 'pray', 'amen') then
    raise exception 'Choose a reaction.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'reaction', 120, interval '15 minutes');
  if p_on then
    insert into community.reactions (target_type, target_id, profile_id, kind) values (p_type, p_id, v_uid, p_kind)
    on conflict do nothing;
  else
    delete from community.reactions where target_type = p_type and target_id = p_id and profile_id = v_uid and kind = p_kind;
  end if;
  return community.reactions_json(p_type, p_id, v_uid);
end;
$$;

create function public.community_follow(p_thread uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if not community.can_read_thread(p_thread, v_uid) then
    raise exception 'That discussion wasn''t found.' using errcode = 'P0002';
  end if;
  if p_on then
    insert into community.follows (thread_id, profile_id) values (p_thread, v_uid) on conflict do nothing;
  else
    delete from community.follows where thread_id = p_thread and profile_id = v_uid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Groups: reading
-- ---------------------------------------------------------------------------
create function community.group_card(g community.groups, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'summary', g.summary,
    'image_path', g.image_path, 'image_alt', g.image_alt,
    'visibility', g.visibility, 'accepts_requests', g.accepts_requests, 'status', g.status,
    'my_role', (select m.role from community.group_members m where m.group_id = g.id and m.profile_id = p_viewer and m.state = 'active'),
    'my_request', exists (select 1 from community.group_requests r where r.group_id = g.id and r.profile_id = p_viewer and r.status = 'pending'),
    'my_invitation', (select i.id from community.group_invitations i
                       where i.group_id = g.id and i.invitee_id = p_viewer and i.status = 'pending' and i.expires_at > now()));
$$;

create function public.community_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  return jsonb_build_object(
    'mine', coalesce((select jsonb_agg(community.group_card(g, v_uid) order by lower(g.name))
                        from community.groups g where community.group_member(g.id, v_uid)), '[]'::jsonb),
    'discover', coalesce((select jsonb_agg(community.group_card(g, v_uid) order by lower(g.name))
                            from community.groups g
                           where g.visibility = 'discoverable' and g.status = 'active'
                             and not community.group_member(g.id, v_uid)), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', i.id, 'expires_at', i.expires_at, 'invited_by', community.display_name(i.invited_by),
                                'group', jsonb_build_object('id', g.id, 'name', g.name, 'summary', g.summary,
                                                            'image_path', g.image_path, 'image_alt', g.image_alt))
                              order by i.created_at desc)
                               from community.group_invitations i join community.groups g on g.id = i.group_id and g.status = 'active'
                              where i.invitee_id = v_uid and i.status = 'pending' and i.expires_at > now()), '[]'::jsonb));
end;
$$;

-- Group detail. Non-members of a discoverable group get only the public
-- card. Members get details, leaders, and member count. Null if the caller
-- may not know the group exists.
create function public.community_group(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  g community.groups;
  v_member boolean;
begin
  select * into g from community.groups where id = p_id;
  if not found or not community.can_see_group(g.id, v_uid) then
    return null;
  end if;
  v_member := community.group_member(g.id, v_uid);
  return community.group_card(g, v_uid) || jsonb_build_object(
    'is_member', v_member,
    'can_manage', community.can_manage_group(g.id),
    'is_admin', (select public.has_capability('community.manage')),
    'about', case when v_member then g.about end,
    'leaders', case when v_member then (
                 select coalesce(jsonb_agg(community.display_name(m.profile_id) order by m.joined_at), '[]'::jsonb)
                   from community.group_members m
                  where m.group_id = g.id and m.state = 'active' and m.role = 'leader' and community.is_member(m.profile_id)) end,
    'member_count', case when v_member or community.can_manage_group(g.id) then (
                      select count(*) from community.group_members m
                       where m.group_id = g.id and m.state = 'active' and community.is_member(m.profile_id)) end,
    'muted', exists (select 1 from community.mutes m where m.profile_id = v_uid and m.target_type = 'group' and m.target_id = g.id));
end;
$$;

-- Roster: active members see names (and whether they may message each
-- person under that person's own message settings); managers also see
-- roles and pending invitations/requests. Never contact details.
create function public.community_group_roster(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_manage boolean := community.can_manage_group(p_id);
begin
  if not (community.group_member(p_id, v_uid) or v_manage) then
    raise exception 'Only group members can see who belongs to it.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.profile_id, 'name', community.display_name(m.profile_id), 'role', m.role,
               'joined_at', m.joined_at, 'me', m.profile_id = v_uid,
               'can_message', community.can_message(v_uid, m.profile_id))
             order by (m.role = 'leader') desc, lower(community.display_name(m.profile_id)))
        from community.group_members m
       where m.group_id = p_id and m.state = 'active' and community.is_member(m.profile_id)), '[]'::jsonb),
    'requests', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', community.display_name(r.profile_id), 'message', r.message,
                                          'created_at', r.created_at) order by r.created_at)
        from community.group_requests r
       where r.group_id = p_id and r.status = 'pending' and community.is_member(r.profile_id)), '[]'::jsonb) end,
    'invitations', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', community.display_name(i.invitee_id),
                                          'expires_at', i.expires_at, 'created_at', i.created_at) order by i.created_at)
        from community.group_invitations i
       where i.group_id = p_id and i.status = 'pending' and i.expires_at > now()), '[]'::jsonb) end,
    'can_manage', v_manage,
    'is_admin', (select public.has_capability('community.manage')));
end;
$$;

-- ---------------------------------------------------------------------------
-- Groups: joining, inviting, leaving
-- ---------------------------------------------------------------------------
create function community.add_member(p_group uuid, p_profile uuid, p_role community.member_role default 'member')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into community.group_members as gm (group_id, profile_id, role, state, joined_at)
  values (p_group, p_profile, p_role, 'active', now())
  on conflict (group_id, profile_id) do update
    set state = 'active', role = case when gm.state = 'active' then gm.role else excluded.role end,
        joined_at = case when gm.state = 'active' then gm.joined_at else now() end,
        ended_at = null, ended_by = null, updated_at = now();
  update community.group_requests set status = 'approved', decided_at = now(), decided_by = (select auth.uid())
   where group_id = p_group and profile_id = p_profile and status = 'pending';
  update community.group_invitations set status = 'accepted', responded_at = now()
   where group_id = p_group and invitee_id = p_profile and status = 'pending';
  perform community.ping(p_profile, 'groups');
end;
$$;

create function public.community_group_request(p_group uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  g community.groups;
  v_id uuid;
  v_leader uuid;
begin
  select * into g from community.groups where id = p_group;
  if not found or g.visibility <> 'discoverable' or g.status <> 'active' then
    raise exception 'That group wasn''t found.' using errcode = 'P0002';
  end if;
  if not g.accepts_requests then
    raise exception 'This group joins by invitation only.' using errcode = '22023';
  end if;
  if community.group_member(g.id, v_uid) then
    raise exception 'You''re already a member of this group.' using errcode = '22023';
  end if;
  if exists (select 1 from community.group_requests where group_id = g.id and profile_id = v_uid and status = 'pending') then
    return;
  end if;
  perform community.rate_limit(v_uid, 'group_request', 10, interval '1 hour');
  insert into community.group_requests (group_id, profile_id, message)
  values (g.id, v_uid, nullif(community.clean_text(coalesce(p_message, ''), 0, 500, 'Your note'), ''))
  returning id into v_id;
  for v_leader in select profile_id from community.group_members where group_id = g.id and role = 'leader' and state = 'active' loop
    perform community.notify(v_leader, 'group_request', v_uid,
      jsonb_build_object('group_id', g.id, 'request_id', v_id), 'group_request:' || g.id);
  end loop;
end;
$$;

create function public.community_group_request_withdraw(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  update community.group_requests set status = 'withdrawn', decided_at = now()
   where group_id = p_group and profile_id = v_uid and status = 'pending';
end;
$$;

create function public.community_group_decide(p_request uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  r community.group_requests;
begin
  select * into r from community.group_requests where id = p_request for update;
  if not found or not community.can_manage_group(r.group_id) then
    raise exception 'That request wasn''t found.' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'That request was already answered.' using errcode = '22023';
  end if;
  if p_approve then
    if not community.is_member(r.profile_id) then
      raise exception 'That person can''t join right now.' using errcode = '22023';
    end if;
    perform community.add_member(r.group_id, r.profile_id);
    perform community.notify(r.profile_id, 'group_request_approved', null, jsonb_build_object('group_id', r.group_id));
  else
    update community.group_requests set status = 'declined', decided_at = now(), decided_by = v_uid where id = r.id;
    perform community.notify(r.profile_id, 'group_request_declined', null, jsonb_build_object('group_id', r.group_id));
  end if;
  perform community.audit(case when p_approve then 'group.request_approved' else 'group.request_declined' end,
                          'group', r.group_id::text, jsonb_build_object('profile', r.profile_id));
end;
$$;

-- Invitee search for group managers: only directory-listed approved adults
-- (the directory's own privacy rules), at least two characters, ten results.
create function public.community_group_invite_search(p_group uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
begin
  if not community.can_manage_group(p_group) then
    raise exception 'You do not have permission to manage this group.' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by lower(x.name))
      from (select p.id, public.directory_display_name(p) as name
              from public.profiles p
             where public.directory_is_listed(p.id)
               and (p.full_name ilike v_like or p.preferred_name ilike v_like)
               and not community.group_member(p_group, p.id)
             order by lower(p.full_name)
             limit 10) x), '[]'::jsonb);
end;
$$;

-- One refusal message for every "can't invite" case, so invitations can't
-- be used to probe whether an account exists or its status.
create function public.community_group_invite(p_group uuid, p_invitee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_id uuid;
begin
  if not community.can_manage_group(p_group)
     or not exists (select 1 from community.groups where id = p_group and status = 'active') then
    raise exception 'You do not have permission to manage this group.' using errcode = '42501';
  end if;
  perform community.rate_limit(v_uid, 'group_invite', 30, interval '1 hour');
  if p_invitee is null or p_invitee = v_uid or not community.is_member(p_invitee) or community.group_member(p_group, p_invitee) then
    raise exception 'That member can''t be invited right now.' using errcode = '22023';
  end if;
  select id into v_id from community.group_invitations where group_id = p_group and invitee_id = p_invitee and status = 'pending';
  if v_id is not null then
    update community.group_invitations set expires_at = greatest(expires_at, now() + interval '14 days') where id = v_id;
    return;
  end if;
  insert into community.group_invitations (group_id, invitee_id, invited_by) values (p_group, p_invitee, v_uid)
  returning id into v_id;
  perform community.notify(p_invitee, 'group_invitation', v_uid, jsonb_build_object('group_id', p_group, 'invitation_id', v_id));
  perform community.audit('group.invited', 'group', p_group::text, jsonb_build_object('profile', p_invitee));
end;
$$;

create function public.community_group_revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i community.group_invitations;
begin
  perform community.require_member();
  select * into i from community.group_invitations where id = p_invitation for update;
  if not found or not community.can_manage_group(i.group_id) then
    raise exception 'That invitation wasn''t found.' using errcode = 'P0002';
  end if;
  if i.status <> 'pending' then
    raise exception 'That invitation is no longer open.' using errcode = '22023';
  end if;
  update community.group_invitations set status = 'revoked', responded_at = now() where id = i.id;
  perform community.audit('group.invitation_revoked', 'group', i.group_id::text, jsonb_build_object('profile', i.invitee_id));
end;
$$;

-- Accept or decline. The row lock plus status/expiry check means an
-- invitation can be used once; revoked, expired, and replayed answers fail.
create function public.community_group_respond(p_invitation uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  i community.group_invitations;
begin
  select * into i from community.group_invitations where id = p_invitation for update;
  if not found or i.invitee_id <> v_uid or i.status <> 'pending' or i.expires_at <= now()
     or not exists (select 1 from community.groups where id = i.group_id and status = 'active') then
    raise exception 'This invitation is no longer available.' using errcode = '22023';
  end if;
  if p_accept then
    perform community.add_member(i.group_id, v_uid);
  else
    update community.group_invitations set status = 'declined', responded_at = now() where id = i.id;
  end if;
  return i.group_id;
end;
$$;

create function public.community_group_leave(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  update community.group_members set state = 'left', ended_at = now(), ended_by = v_uid, updated_at = now()
   where group_id = p_group and profile_id = v_uid and state = 'active';
  if not found then
    raise exception 'You''re not a member of that group.' using errcode = '22023';
  end if;
end;
$$;

-- Leaders remove members. Changing leaders (appoint, step down, remove a
-- leader) is for community.manage holders; the last-leader trigger applies.
create function public.community_group_set_member(p_group uuid, p_profile uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  m community.group_members;
  v_admin boolean := (select public.has_capability('community.manage'));
begin
  if not community.can_manage_group(p_group) then
    raise exception 'You do not have permission to manage this group.' using errcode = '42501';
  end if;
  if p_action = 'add_leader' then
    if not v_admin then
      raise exception 'Only community administrators appoint group leaders.' using errcode = '42501';
    end if;
    if not community.is_member(p_profile) then
      raise exception 'That person can''t lead a group right now.' using errcode = '22023';
    end if;
    perform community.add_member(p_group, p_profile, 'leader');
    update community.group_members set role = 'leader', updated_at = now() where group_id = p_group and profile_id = p_profile;
    perform community.notify(p_profile, 'group_role', v_uid, jsonb_build_object('group_id', p_group, 'detail', jsonb_build_object('role', 'leader')));
    perform community.audit('group.leader_appointed', 'group', p_group::text, jsonb_build_object('profile', p_profile));
    return;
  end if;
  select * into m from community.group_members where group_id = p_group and profile_id = p_profile and state = 'active' for update;
  if not found then
    raise exception 'That person isn''t a member of this group.' using errcode = 'P0002';
  end if;
  if p_action = 'remove' then
    if m.role = 'leader' and not v_admin then
      raise exception 'Only community administrators remove group leaders.' using errcode = '42501';
    end if;
    if p_profile = v_uid then
      raise exception 'Use Leave group to leave it yourself.' using errcode = '22023';
    end if;
    update community.group_members set state = 'removed', ended_at = now(), ended_by = v_uid, updated_at = now()
     where group_id = p_group and profile_id = p_profile;
    perform community.notify(p_profile, 'group_removed', null, jsonb_build_object('group_id', p_group));
    perform community.audit('group.member_removed', 'group', p_group::text, jsonb_build_object('profile', p_profile, 'role', m.role));
  elsif p_action = 'remove_leader_role' then
    if not v_admin then
      raise exception 'Only community administrators change group leaders.' using errcode = '42501';
    end if;
    update community.group_members set role = 'member', updated_at = now() where group_id = p_group and profile_id = p_profile;
    perform community.notify(p_profile, 'group_role', v_uid, jsonb_build_object('group_id', p_group, 'detail', jsonb_build_object('role', 'member')));
    perform community.audit('group.leader_removed', 'group', p_group::text, jsonb_build_object('profile', p_profile));
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end;
$$;

-- When someone stops being an active member: drop their follows of the
-- group's discussions, cancel group-event registrations (current and future
-- occurrences; Phase 4 policy: "ineligible", no email, waitlist promoted),
-- drop their queued event email for those events, and refresh their screens.
create function community.on_group_membership_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ uuid;
begin
  if old.state = 'active' and new.state <> 'active' then
    delete from community.follows f using community.threads t
     where t.id = f.thread_id and t.group_id = new.group_id and f.profile_id = new.profile_id;
    update events.outbox e set status = 'skipped', updated_at = now()
      from events.occurrences o join events.series s on s.id = o.series_id
     where e.occurrence_id = o.id and s.group_id = new.group_id and e.profile_id = new.profile_id
       and e.status in ('pending', 'failed');
    for v_occ in
      update events.registrations r
         set status = 'canceled', canceled_at = now(), cancel_reason = 'ineligible', updated_at = now()
        from events.occurrences o join events.series s on s.id = o.series_id
       where o.id = r.occurrence_id and s.group_id = new.group_id and r.profile_id = new.profile_id
         and r.status <> 'canceled' and o.ends_at > now()
      returning r.occurrence_id
    loop
      perform events.promote(v_occ);
    end loop;
    perform community.ping(new.profile_id, 'groups');
  end if;
  return new;
end;
$$;

create trigger group_members_on_end
  after update of state on community.group_members
  for each row execute function community.on_group_membership_end();

-- ---------------------------------------------------------------------------
-- Groups: administration
-- ---------------------------------------------------------------------------
-- Create (community.manage; needs a first leader) or edit (group managers).
-- Only community.manage changes visibility. p: {id?, name, summary, about,
-- image_path, image_alt, visibility, accepts_requests, leader_id}
create function public.community_group_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_admin boolean := (select public.has_capability('community.manage'));
  g community.groups;
  v_vis community.group_visibility;
  v_leader uuid := nullif(p ->> 'leader_id', '')::uuid;
  v_requests boolean;
  v_image text := nullif(p ->> 'image_path', '');
begin
  if v_image is not null and v_image !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.webp$' then
    raise exception 'That image isn''t valid.' using errcode = '22023';
  end if;
  if v_id is null then
    if not v_admin then
      raise exception 'Only community administrators create groups.' using errcode = '42501';
    end if;
    if v_leader is null or not community.is_member(v_leader) then
      raise exception 'Choose an approved member to lead the group.' using errcode = '22023';
    end if;
    v_vis := coalesce(nullif(p ->> 'visibility', ''), 'discoverable')::community.group_visibility;
    insert into community.groups (name, summary, about, visibility, accepts_requests, created_by)
    values (community.clean_text(p ->> 'name', 2, 80, 'The group name'),
            community.clean_text(coalesce(p ->> 'summary', ''), 0, 400, 'The summary'),
            community.clean_text(coalesce(p ->> 'about', ''), 0, 5000, 'The details'),
            v_vis, v_vis = 'discoverable' and coalesce((p ->> 'accepts_requests')::boolean, true), v_uid)
    returning id into v_id;
    insert into community.group_members (group_id, profile_id, role) values (v_id, v_leader, 'leader');
    perform community.notify(v_leader, 'group_role', v_uid, jsonb_build_object('group_id', v_id, 'detail', jsonb_build_object('role', 'leader')));
    perform community.audit('group.created', 'group', v_id::text, jsonb_build_object('visibility', v_vis, 'leader', v_leader));
    return v_id;
  end if;

  select * into g from community.groups where id = v_id for update;
  if not found or not community.can_manage_group(v_id) then
    raise exception 'That group wasn''t found.' using errcode = 'P0002';
  end if;
  if g.status = 'archived' then
    raise exception 'Archived groups can''t be edited. Restore it first.' using errcode = '22023';
  end if;
  v_vis := case when v_admin and nullif(p ->> 'visibility', '') is not null then (p ->> 'visibility')::community.group_visibility else g.visibility end;
  v_requests := v_vis = 'discoverable' and coalesce((p ->> 'accepts_requests')::boolean, g.accepts_requests);
  if v_image is not null and split_part(v_image, '/', 1) <> v_id::text then
    raise exception 'That image isn''t valid.' using errcode = '22023';
  end if;
  update community.groups
     set name = community.clean_text(coalesce(p ->> 'name', g.name), 2, 80, 'The group name'),
         summary = community.clean_text(coalesce(p ->> 'summary', g.summary), 0, 400, 'The summary'),
         about = community.clean_text(coalesce(p ->> 'about', g.about), 0, 5000, 'The details'),
         image_path = case when p ? 'image_path' then v_image else g.image_path end,
         image_alt = case when p ? 'image_path' then case when v_image is null then null else nullif(btrim(p ->> 'image_alt'), '') end
                          when p ? 'image_alt' and g.image_path is not null then nullif(btrim(p ->> 'image_alt'), '')
                          else g.image_alt end,
         visibility = v_vis,
         accepts_requests = v_requests,
         updated_at = now()
   where id = v_id;
  if not v_requests then
    update community.group_requests set status = 'declined', decided_at = now(), decided_by = v_uid
     where group_id = v_id and status = 'pending';
  end if;
  perform community.audit('group.updated', 'group', v_id::text,
    jsonb_build_object('visibility_changed', v_vis is distinct from g.visibility));
  return v_id;
end;
$$;

-- Archive: discussions become read-only, open invitations and requests close,
-- members keep read access. Restore reopens it (a leader is required).
create function public.community_group_archive(p_group uuid, p_archive boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_capability('community.manage');
begin
  perform pg_advisory_xact_lock(hashtext('community.group:' || p_group::text));
  if p_archive then
    update community.groups set status = 'archived', archived_at = now(), updated_at = now() where id = p_group and status = 'active';
    if not found then
      raise exception 'That group isn''t active.' using errcode = '22023';
    end if;
    update community.group_invitations set status = 'revoked', responded_at = now() where group_id = p_group and status = 'pending';
    update community.group_requests set status = 'declined', decided_at = now(), decided_by = v_uid where group_id = p_group and status = 'pending';
  else
    if not exists (select 1 from community.group_members where group_id = p_group and role = 'leader' and state = 'active') then
      raise exception 'Appoint a leader before restoring this group.' using errcode = '22023';
    end if;
    update community.groups set status = 'active', archived_at = null, updated_at = now() where id = p_group and status = 'archived';
    if not found then
      raise exception 'That group isn''t archived.' using errcode = '22023';
    end if;
  end if;
  perform community.audit(case when p_archive then 'group.archived' else 'group.restored' end, 'group', p_group::text);
end;
$$;

create function public.community_admin_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform community.require_capability('community.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'name', g.name, 'visibility', g.visibility, 'status', g.status, 'accepts_requests', g.accepts_requests,
             'members', (select count(*) from community.group_members m where m.group_id = g.id and m.state = 'active'),
             'leaders', (select coalesce(jsonb_agg(jsonb_build_object('id', m.profile_id, 'name', community.display_name(m.profile_id),
                                                                    'approved', community.is_member(m.profile_id))), '[]'::jsonb)
                           from community.group_members m where m.group_id = g.id and m.state = 'active' and m.role = 'leader'),
             'created_at', g.created_at)
           order by g.status, lower(g.name))
      from community.groups g), '[]'::jsonb);
end;
$$;

-- Leader candidates for administrators: approved adults by name (no contact
-- details; includes members who opted out of the directory, because a
-- leader appointment is an administrative act).
create function public.community_admin_member_search(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
begin
  perform community.require_capability('community.manage');
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by lower(x.name))
      from (select p.id, public.directory_display_name(p) as name from public.profiles p
             where p.membership_status = 'approved' and p.account_kind = 'adult'
               and (p.full_name ilike v_like or p.preferred_name ilike v_like)
             order by lower(p.full_name) limit 15) x), '[]'::jsonb);
end;
$$;

-- Group images: private bucket, readable by people who may see the group.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-images', 'group-images', false, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.can_view_group_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from community.groups g
                  where g.image_path = p_name and community.can_see_group(g.id, (select auth.uid())));
$$;

create function public.can_manage_group_image(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  if p_name !~ '^[0-9a-f-]{36}/' then
    return false;
  end if;
  v_group := split_part(p_name, '/', 1)::uuid;
  return community.can_manage_group(v_group);
end;
$$;

create policy "Group images follow group visibility"
  on storage.objects for select to authenticated
  using (bucket_id = 'group-images' and (select public.can_view_group_image(storage.objects.name)));

create policy "Group managers upload group images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'group-images' and (select public.can_manage_group_image(storage.objects.name)));

create policy "Group managers delete group images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'group-images' and (select public.can_manage_group_image(storage.objects.name)));

-- ---------------------------------------------------------------------------
-- Phase 4 integration: group-restricted events
-- ---------------------------------------------------------------------------
-- Real group membership replaces the Phase 4 placeholder. Every events path
-- already goes through events.visible_to / audience_allows: lists, details,
-- RSVP, waitlist promotion, images, ICS, both feeds, and email rechecks.
create or replace function events.group_member(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_group is not null and community.group_member(p_group, p_profile);
$$;
revoke execute on function events.group_member(uuid, uuid) from public, anon, authenticated;

alter table events.series drop constraint series_groups_unavailable;
alter table events.series
  add constraint series_group_audience check ((audience = 'group') = (group_id is not null)),
  add constraint series_group_fk foreign key (group_id) references community.groups (id);
create index series_group_idx on events.series (group_id);

-- Which groups an event coordinator may target: discoverable active groups,
-- plus hidden groups they administer (community.manage) or lead.
create function events.can_target_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from community.groups g
                  where g.id = p_group and g.status = 'active'
                    and (g.visibility = 'discoverable'
                         or (select public.has_capability('community.manage'))
                         or community.group_leader(g.id, (select auth.uid()))));
$$;

create function public.events_admin_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform events.require_manager();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'visibility', g.visibility) order by lower(g.name))
      from community.groups g where events.can_target_group(g.id)), '[]'::jsonb);
end;
$$;

-- events_admin_save, now accepting group_id (Phase 4 ignored it).
create or replace function public.events_admin_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_fields jsonb := p - array['id', 'status', 'publish_at', 'sequence', 'created_by', 'updated_by', 'created_at',
                              'updated_at', 'canceled_at', 'cancel_reason'];
  x events.series;
  old events.series;
  v_new events.series;
  v_result jsonb;
  v_occ uuid;
begin
  perform events.require_manager();
  if not v_fields ? 'audience' then
    v_fields := v_fields || jsonb_build_object('audience', coalesce((select audience from events.series where id = v_id), 'members'),
                                               'group_id', (select group_id from events.series where id = v_id));
  end if;
  if coalesce(v_fields ->> 'audience', '') <> 'group' then
    v_fields := jsonb_set(v_fields, '{group_id}', 'null'::jsonb);
  elsif nullif(v_fields ->> 'group_id', '') is null or not events.can_target_group((v_fields ->> 'group_id')::uuid) then
    raise exception 'Choose a group for a group event.' using errcode = '22023';
  end if;
  if v_id is null then
    x := jsonb_populate_record(null::events.series, v_fields);
    insert into events.series (title, description, cover_path, cover_alt, category_id, audience, group_id, timezone, all_day,
                               start_date, start_time, duration_minutes, day_count, location_name, location_address,
                               online_url, organizer_name, rsvp_enabled, capacity, waitlist_enabled, rsvp_close_minutes,
                               cancellation_instructions, reminder_minutes, recurrence, interval_count, weekdays,
                               monthly_mode, month_ordinal, until_date, occurrence_limit)
    values (x.title, coalesce(x.description, ''), x.cover_path, x.cover_alt, x.category_id, coalesce(x.audience, 'members'), x.group_id,
            x.timezone, coalesce(x.all_day, false), x.start_date, x.start_time, x.duration_minutes, x.day_count,
            x.location_name, x.location_address, x.online_url, x.organizer_name, coalesce(x.rsvp_enabled, false),
            x.capacity, coalesce(x.waitlist_enabled, false), x.rsvp_close_minutes, x.cancellation_instructions,
            coalesce(x.reminder_minutes, (select default_reminder_minutes from events.settings)),
            coalesce(x.recurrence, 'none'), coalesce(x.interval_count, 1), x.weekdays, x.monthly_mode, x.month_ordinal,
            x.until_date, x.occurrence_limit)
    returning id into v_id;
    v_result := events.sync_occurrences(v_id, false);
    return v_result || jsonb_build_object('id', v_id);
  end if;

  select * into old from events.series where id = v_id for update;
  if not found then
    raise exception 'That event wasn''t found.' using errcode = 'P0002';
  end if;
  if old.status in ('canceled', 'archived') then
    raise exception 'Canceled or archived events can''t be edited.' using errcode = '22023';
  end if;
  x := jsonb_populate_record(old, v_fields);
  update events.series
     set title = x.title, description = coalesce(x.description, ''), cover_path = x.cover_path, cover_alt = x.cover_alt,
         category_id = x.category_id, audience = x.audience, group_id = x.group_id, timezone = x.timezone, all_day = x.all_day,
         start_date = x.start_date, start_time = x.start_time, duration_minutes = x.duration_minutes, day_count = x.day_count,
         location_name = x.location_name, location_address = x.location_address, online_url = x.online_url,
         organizer_name = x.organizer_name, rsvp_enabled = x.rsvp_enabled, capacity = x.capacity,
         waitlist_enabled = x.waitlist_enabled, rsvp_close_minutes = x.rsvp_close_minutes,
         cancellation_instructions = x.cancellation_instructions, reminder_minutes = x.reminder_minutes,
         recurrence = x.recurrence, interval_count = x.interval_count, weekdays = x.weekdays, monthly_mode = x.monthly_mode,
         month_ordinal = x.month_ordinal, until_date = x.until_date, occurrence_limit = x.occurrence_limit,
         sequence = sequence + case when old.status = 'published' then 1 else 0 end
   where id = v_id
  returning * into v_new;

  v_result := events.sync_occurrences(
    v_id,
    old.status = 'published',
    (old.location_name, old.location_address, old.online_url) is distinct from (v_new.location_name, v_new.location_address, v_new.online_url));

  if old.status = 'published' and (old.audience, old.group_id) is distinct from (v_new.audience, v_new.group_id) then
    v_result := v_result || jsonb_build_object('removed_ineligible', events.recheck_series(v_id));
  end if;
  if old.status = 'published' and v_new.rsvp_enabled
     and (v_new.capacity is null or old.capacity is null or v_new.capacity > old.capacity or not old.rsvp_enabled) then
    for v_occ in select id from events.occurrences where series_id = v_id and ends_at > now() loop
      perform events.promote(v_occ);
    end loop;
  end if;
  return v_result || jsonb_build_object('id', v_id);
end;
$$;

-- Event detail, now naming the group for its members (only ever returned
-- after the visibility check, so a former member gets "not found").
create or replace function public.events_occurrence(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_series uuid;
begin
  select series_id into v_series from events.occurrences where id = p_id;
  if v_series is null or not events.visible_to(v_series, v_uid) then
    return null;
  end if;
  return events.occurrence_json(p_id, v_uid) || jsonb_build_object(
    'group', (select jsonb_build_object('id', g.id, 'name', g.name)
                from events.series s join community.groups g on g.id = s.group_id
               where s.id = v_series and s.audience = 'group'),
    'more', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'status', o.status)
                       order by o.starts_at)
        from (select * from events.occurrences
               where series_id = v_series and id <> p_id and ends_at > now()
               order by starts_at limit 8) o), '[]'::jsonb));
end;
$$;

-- Upcoming events of one group, for its members.
create function public.community_group_events(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if not community.group_member(p_group, v_uid) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(events.occurrence_json(x.id, v_uid) order by x.starts_at)
      from (select o.id, o.starts_at from events.occurrences o join events.series s on s.id = o.series_id
             where s.group_id = p_group and s.audience = 'group' and o.ends_at > now()
               and events.visible_to(s.id, v_uid)
             order by o.starts_at limit 10) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema community from public, anon, authenticated;
revoke execute on all functions in schema events from public, anon, authenticated;

revoke execute on function
  public.community_guidelines(), public.community_ack_guidelines(integer), public.community_categories(),
  public.community_threads(uuid, uuid, timestamptz, uuid, integer), public.community_recent(integer),
  public.community_thread(uuid, timestamptz, uuid, integer), public.community_thread_create(uuid, uuid, text, text, uuid),
  public.community_thread_edit(uuid, text, text), public.community_thread_delete(uuid), public.community_reply(uuid, text, uuid),
  public.community_reply_edit(uuid, text), public.community_reply_delete(uuid), public.community_react(text, uuid, text, boolean),
  public.community_follow(uuid, boolean), public.community_groups(), public.community_group(uuid),
  public.community_group_roster(uuid), public.community_group_request(uuid, text), public.community_group_request_withdraw(uuid),
  public.community_group_decide(uuid, boolean), public.community_group_invite_search(uuid, text),
  public.community_group_invite(uuid, uuid), public.community_group_revoke_invitation(uuid),
  public.community_group_respond(uuid, boolean), public.community_group_leave(uuid),
  public.community_group_set_member(uuid, uuid, text), public.community_group_save(jsonb),
  public.community_group_archive(uuid, boolean), public.community_admin_groups(), public.community_admin_member_search(text),
  public.can_view_group_image(text), public.can_manage_group_image(text), public.events_admin_groups(),
  public.community_group_events(uuid)
from public;

grant execute on function
  public.community_guidelines(), public.community_ack_guidelines(integer), public.community_categories(),
  public.community_threads(uuid, uuid, timestamptz, uuid, integer), public.community_recent(integer),
  public.community_thread(uuid, timestamptz, uuid, integer), public.community_thread_create(uuid, uuid, text, text, uuid),
  public.community_thread_edit(uuid, text, text), public.community_thread_delete(uuid), public.community_reply(uuid, text, uuid),
  public.community_reply_edit(uuid, text), public.community_reply_delete(uuid), public.community_react(text, uuid, text, boolean),
  public.community_follow(uuid, boolean), public.community_groups(), public.community_group(uuid),
  public.community_group_roster(uuid), public.community_group_request(uuid, text), public.community_group_request_withdraw(uuid),
  public.community_group_decide(uuid, boolean), public.community_group_invite_search(uuid, text),
  public.community_group_invite(uuid, uuid), public.community_group_revoke_invitation(uuid),
  public.community_group_respond(uuid, boolean), public.community_group_leave(uuid),
  public.community_group_set_member(uuid, uuid, text), public.community_group_save(jsonb),
  public.community_group_archive(uuid, boolean), public.community_admin_groups(), public.community_admin_member_search(text),
  public.can_view_group_image(text), public.can_manage_group_image(text), public.events_admin_groups(),
  public.community_group_events(uuid)
to authenticated;

-- events_occurrence keeps its Phase 4 grants (visitors see public events).
grant execute on function public.events_occurrence(uuid) to anon, authenticated;
grant execute on function public.events_admin_save(jsonb) to authenticated;
