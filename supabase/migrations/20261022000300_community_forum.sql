-- Phase 5 · Community: discussions (categories, threads, replies, reactions, follows).
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
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema community from public, anon, authenticated;

revoke execute on function
  public.community_guidelines(), public.community_ack_guidelines(integer), public.community_categories(),
  public.community_threads(uuid, uuid, timestamptz, uuid, integer), public.community_recent(integer), public.community_thread(uuid, timestamptz, uuid, integer),
  public.community_thread_create(uuid, uuid, text, text, uuid), public.community_thread_edit(uuid, text, text), public.community_thread_delete(uuid),
  public.community_reply(uuid, text, uuid), public.community_reply_edit(uuid, text), public.community_reply_delete(uuid),
  public.community_react(text, uuid, text, boolean), public.community_follow(uuid, boolean)
from public;

grant execute on function
  public.community_guidelines(), public.community_ack_guidelines(integer), public.community_categories(),
  public.community_threads(uuid, uuid, timestamptz, uuid, integer), public.community_recent(integer), public.community_thread(uuid, timestamptz, uuid, integer),
  public.community_thread_create(uuid, uuid, text, text, uuid), public.community_thread_edit(uuid, text, text), public.community_thread_delete(uuid),
  public.community_reply(uuid, text, uuid), public.community_reply_edit(uuid, text), public.community_reply_delete(uuid),
  public.community_react(text, uuid, text, boolean), public.community_follow(uuid, boolean)
to authenticated;
