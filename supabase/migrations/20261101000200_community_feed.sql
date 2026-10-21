-- Community social feed (additive).
--
-- The Community page becomes a newest-first feed of original posts with
-- comments collapsed under each one. Nothing existing is changed except
-- community_notification_open, which now adds ?comment=<post> to reply
-- notification links so the feed can reveal that comment.
--
-- Ordering: posts by created_at desc, id desc; comments the same way. Cursors
-- are (created_at, id) pairs, so equal timestamps never skip or repeat an
-- item, and replies, reactions, and edits (which move last_activity_at or
-- edited_at) never move a post. Pinned posts keep their normal place in the
-- feed and are also listed separately on the first page.
--
-- Access is the same as the existing discussion functions: approved adult
-- members only (community.require_member), group posts only for current
-- group members, hidden content only for people who can moderate it, and
-- deleted posts left out. Comment counts are counted with the same rule, so
-- they never reveal hidden replies to people who can't see them.

create index if not exists threads_created_idx on community.threads (created_at desc, id desc);
create index if not exists threads_category_created_idx on community.threads (category_id, created_at desc, id desc) where category_id is not null;
create index if not exists threads_group_created_idx on community.threads (group_id, created_at desc, id desc) where group_id is not null;

-- One post in the feed: the thread card plus its text, reactions, photos and
-- videos, and a comment count the viewer is allowed to see.
create function community.feed_card(t community.threads, p_viewer uuid, p_mod boolean, p_can_post boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select community.thread_card(t, p_viewer) || jsonb_build_object(
    'title', case when t.status = 'visible' or (t.status = 'hidden' and p_mod) then t.title end,
    'body', case when t.status = 'visible' or (t.status = 'hidden' and p_mod) then t.body end,
    'author', case when t.status <> 'deleted' and t.author_id is not null then community.display_name(t.author_id) end,
    'edited_at', t.edited_at,
    'audience', case when t.group_id is null then 'church' else 'group' end,
    'group_archived', coalesce((select g.status::text = 'archived' from community.groups g where g.id = t.group_id), false),
    'reactions', case when t.status = 'visible' then community.reactions_json('thread', t.id, p_viewer) end,
    'comment_count', (select count(*) from community.posts p
                       where p.thread_id = t.id and (p.status = 'visible' or (p.status = 'hidden' and p_mod))),
    'attachments', coalesce((select jsonb_agg(community.attachment_json(a) order by a.sort_order, a.created_at)
                               from community.attachments a
                              where a.thread_id = t.id and a.target_type = 'thread' and a.status = 'attached'
                                and community.attachment_visible(a)), '[]'::jsonb),
    'can_moderate', p_mod,
    'can_reply', p_can_post and t.status = 'visible' and not t.locked
                 and coalesce((select g.status::text = 'active' from community.groups g where g.id = t.group_id), true),
    'muted', exists (select 1 from community.mutes m where m.profile_id = p_viewer and m.target_type = 'thread' and m.target_id = t.id));
$$;

-- Whether the viewer may see a thread in the feed (beyond can_read_thread).
create function community.feed_moderates(t community.threads, p_viewer uuid, p_global boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_global or (t.group_id is not null and community.group_leader(t.group_id, p_viewer));
$$;

-- The feed: everything the member may read (church-wide posts in active
-- categories plus their groups), or one category, or one group. Newest
-- original post first; p_cursor_* continues after the last item.
create function public.community_feed(
  p_category uuid default null, p_group uuid default null,
  p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 30);
  v_global boolean := (select public.has_capability('community.moderate'));
  v_can_post boolean;
  v_items jsonb;
  v_pinned jsonb;
begin
  if p_category is not null and p_group is not null then
    raise exception 'Choose a category or a group, not both.' using errcode = '22023';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'That page link isn''t valid.' using errcode = '22023';
  end if;
  if p_group is not null and not community.group_member(p_group, v_uid) then
    raise exception 'That group''s discussions are only for its members.' using errcode = '42501';
  end if;
  if p_category is not null and not exists (select 1 from community.categories where id = p_category and active) then
    raise exception 'That category wasn''t found.' using errcode = 'P0002';
  end if;
  v_can_post := community.has_acked(v_uid) and not community.restricted(v_uid, 'posting');

  select coalesce(jsonb_agg(community.feed_card(x.t, v_uid, x.m, v_can_post) order by (x.t).created_at desc, (x.t).id desc), '[]'::jsonb)
    into v_items
    from (select t, community.feed_moderates(t, v_uid, v_global) m
            from community.threads t
           where case when p_category is not null then t.category_id = p_category
                      when p_group is not null then t.group_id = p_group
                      else (t.group_id is null and exists (select 1 from community.categories c where c.id = t.category_id and c.active))
                           or (t.group_id is not null and community.group_member(t.group_id, v_uid)) end
             and (t.status = 'visible' or (t.status = 'hidden' and community.feed_moderates(t, v_uid, v_global)))
             and (p_cursor_at is null or (t.created_at, t.id) < (p_cursor_at, p_cursor_id))
           order by t.created_at desc, t.id desc
           limit v_limit) x;

  -- Pinned posts, listed apart on the first page only; they also keep their
  -- own place in the chronological feed.
  if p_cursor_at is null then
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'created_at', t.created_at,
                                                 'author', case when t.author_id is not null then community.display_name(t.author_id) end)
                              order by t.created_at desc, t.id desc), '[]'::jsonb)
      into v_pinned
      from (select t.* from community.threads t
             where t.pinned and t.status = 'visible'
               and case when p_category is not null then t.category_id = p_category
                        when p_group is not null then t.group_id = p_group
                        else (t.group_id is null and exists (select 1 from community.categories c where c.id = t.category_id and c.active))
                             or (t.group_id is not null and community.group_member(t.group_id, v_uid)) end
             order by t.created_at desc, t.id desc
             limit 5) t;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'pinned', coalesce(v_pinned, '[]'::jsonb),
    'can_post', v_can_post,
    'next_cursor', case when jsonb_array_length(v_items) = v_limit
                        then jsonb_build_object('at', v_items -> (v_limit - 1) ->> 'created_at',
                                                'id', v_items -> (v_limit - 1) ->> 'id') end);
end;
$$;

-- How many posts the member may see that are newer than (p_at, p_id), for
-- the "New posts" notice (capped; the feed itself rechecks everything).
create function public.community_feed_newer(p_category uuid, p_group uuid, p_at timestamptz, p_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_global boolean := (select public.has_capability('community.moderate'));
begin
  if p_at is null or p_id is null or (p_category is not null and p_group is not null) then
    return 0;
  end if;
  if p_group is not null and not community.group_member(p_group, v_uid) then
    return 0;
  end if;
  return (select count(*)::integer from (
            select 1 from community.threads t
             where case when p_category is not null then t.category_id = p_category
                        when p_group is not null then t.group_id = p_group
                        else (t.group_id is null and exists (select 1 from community.categories c where c.id = t.category_id and c.active))
                             or (t.group_id is not null and community.group_member(t.group_id, v_uid)) end
               and (t.status = 'visible' or (t.status = 'hidden' and community.feed_moderates(t, v_uid, v_global)))
               and (t.created_at, t.id) > (p_at, p_id)
             limit 99) x);
end;
$$;

-- One post as a feed card (its permalink, or a card refreshed after an
-- action). Null when it doesn't exist or the caller can't read it; a
-- deleted post comes back with no title or text.
create function public.community_feed_post(p_id uuid)
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
begin
  select * into t from community.threads where id = p_id;
  if not found or not community.can_read_thread(t.id, v_uid) then
    return null;
  end if;
  v_mod := community.can_moderate_thread(t.id);
  if t.status = 'hidden' and not v_mod then
    return null;
  end if;
  return community.feed_card(t, v_uid, v_mod, community.has_acked(v_uid) and not community.restricted(v_uid, 'posting'));
end;
$$;

-- One comment (a reply) with its photos and videos.
create function community.comment_json(p community.posts, p_viewer uuid, p_mod boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select community.post_json(p, p_viewer, p_mod) || jsonb_build_object(
    'attachments', coalesce((select jsonb_agg(community.attachment_json(a) order by a.sort_order, a.created_at)
                               from community.attachments a
                              where a.post_id = p.id and a.target_type = 'post' and a.status = 'attached'
                                and community.attachment_visible(a)), '[]'::jsonb));
$$;

-- Comments on one post, newest first. Deleted comments are left out; hidden
-- ones only for people who can moderate the post. p_through (a comment id)
-- extends this page far enough to include that comment, for notification
-- links (at most 500). Null when the post can't be read.
create function public.community_comments(
  p_thread uuid, p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limit integer default 10, p_through uuid default null)
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
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_target community.posts;
  v_found boolean := false;
  v_items jsonb;
  v_group_status text := 'active';
begin
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'That page link isn''t valid.' using errcode = '22023';
  end if;
  select * into t from community.threads where id = p_thread;
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

  if p_through is not null then
    select * into v_target from community.posts p
     where p.id = p_through and p.thread_id = t.id
       and (p.status = 'visible' or (p.status = 'hidden' and v_mod));
    v_found := v_target.id is not null;
    if v_found then
      v_limit := least(greatest(v_limit, (
        select count(*)::integer from community.posts p
         where p.thread_id = t.id and (p.status = 'visible' or (p.status = 'hidden' and v_mod))
           and (p.created_at, p.id) >= (v_target.created_at, v_target.id)
           and (p_cursor_at is null or (p.created_at, p.id) < (p_cursor_at, p_cursor_id)))), 500);
    end if;
  end if;

  select coalesce(jsonb_agg(community.comment_json(x, v_uid, v_mod) order by x.created_at desc, x.id desc), '[]'::jsonb)
    into v_items
    from (select p.* from community.posts p
           where p.thread_id = t.id and (p.status = 'visible' or (p.status = 'hidden' and v_mod))
             and (p_cursor_at is null or (p.created_at, p.id) < (p_cursor_at, p_cursor_id))
           order by p.created_at desc, p.id desc
           limit v_limit) x;

  return jsonb_build_object(
    'items', v_items,
    'count', (select count(*) from community.posts p
               where p.thread_id = t.id and (p.status = 'visible' or (p.status = 'hidden' and v_mod))),
    'target_found', v_found,
    'can_moderate', v_mod,
    'can_reply', t.status = 'visible' and not t.locked and v_group_status = 'active'
                 and community.has_acked(v_uid) and not community.restricted(v_uid, 'posting'),
    'next_cursor', case when jsonb_array_length(v_items) = v_limit
                        then jsonb_build_object('at', v_items -> (v_limit - 1) ->> 'created_at',
                                                'id', v_items -> (v_limit - 1) ->> 'id') end);
end;
$$;

-- Notification links: same checks and URL as before, plus ?comment=<reply>
-- for reply notifications so the post opens with that comment revealed.
create or replace function public.community_notification_open(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  n community.notifications;
  v_url text;
begin
  select * into n from community.notifications where id = p_id and profile_id = v_uid;
  if not found then
    return null;
  end if;
  update community.notifications set read_at = coalesce(read_at, now()) where id = n.id;
  perform community.ping(v_uid, 'read');
  if not community.notification_visible(n) then
    return null;
  end if;
  v_url := community.notification_json(n) ->> 'url';
  if n.post_id is not null and n.thread_id is not null and v_url = '/community/t/' || n.thread_id then
    v_url := v_url || '?comment=' || n.post_id;
  end if;
  return v_url;
end;
$$;

revoke execute on function
  community.feed_card(community.threads, uuid, boolean, boolean), community.feed_moderates(community.threads, uuid, boolean),
  community.comment_json(community.posts, uuid, boolean)
from public, anon, authenticated, service_role;

revoke execute on function
  public.community_feed(uuid, uuid, timestamptz, uuid, integer), public.community_feed_newer(uuid, uuid, timestamptz, uuid), public.community_feed_post(uuid),
  public.community_comments(uuid, timestamptz, uuid, integer, uuid)
from public, anon, service_role;

grant execute on function
  public.community_feed(uuid, uuid, timestamptz, uuid, integer), public.community_feed_newer(uuid, uuid, timestamptz, uuid), public.community_feed_post(uuid),
  public.community_comments(uuid, timestamptz, uuid, integer, uuid)
to authenticated;
