-- Phase 6 · Prayer requests: reading, writing, prayers, follows, reports,
-- moderation, identity lookup, and settings.
--
--   * Every function rechecks the read rule (prayer.can_read) on each call;
--     lists, counts, filters, search, and details all go through it, so
--     hidden content never reaches the browser.
--   * No response contains a profile id for anyone but the caller ("mine"
--     flags instead). Anonymous requests show "Anonymous"; the requester's
--     own anonymous comments and updates show "The requester".
--   * Audience changes: narrowing applies at once and tidies follows and
--     queued notices; broadening (including publishing a draft and restoring
--     from the archive) needs p_confirm = the new audience. Earlier comments
--     and updates stay limited to the audience they were written for
--     (prayer.sees_item), so they never reach a wider audience silently.
--   * Moderation never grants browsing: prayer moderators act on reported
--     items (team-audience reports also need prayer.confidential) or on
--     requests they could read anyway.
--   * Audit and logs record ids, actions, and audiences — never titles,
--     bodies, or comments.

-- ---------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------
create function prayer.card(r prayer.requests, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'excerpt', left(regexp_replace(r.body, '\s+', ' ', 'g'), 160),
    'audience', r.audience,
    'group', case when r.group_id is null then null
                  else (select jsonb_build_object('id', g.id, 'name', g.name) from community.groups g where g.id = r.group_id) end,
    'status', r.status,
    'anonymous', r.anonymous,
    'author', prayer.author_label(r, p_viewer),
    'mine', r.author_id = p_viewer,
    'hidden', r.hidden_at is not null,
    'comments_open', r.comments_enabled and not r.mod_locked,
    'created_at', r.created_at, 'published_at', r.published_at,
    'last_activity_at', r.last_activity_at, 'answered_at', r.answered_at,
    'prayer_count', (select count(*) from prayer.prayers p where p.request_id = r.id),
    'praying', exists (select 1 from prayer.prayers p where p.request_id = r.id and p.profile_id = p_viewer),
    'following', exists (select 1 from prayer.follows f where f.request_id = r.id and f.profile_id = p_viewer),
    'comment_count', (select count(*) from prayer.comments c
                       where c.request_id = r.id and c.status = 'visible'
                         and prayer.sees_item(r, c.posted_audience, c.posted_group, c.author_id, p_viewer)),
    'update_count', (select count(*) from prayer.updates u
                      where u.request_id = r.id and prayer.sees_item(r, u.posted_audience, u.posted_group, u.author_id, p_viewer)));
$$;

create function prayer.comment_json(c prayer.comments, r prayer.requests, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'body', case when c.status = 'visible' then c.body end,
    'author', case when c.status = 'deleted' then null
                   when c.anonymous then 'The requester'
                   else community.display_name(c.author_id) end,
    -- A named comment by the requester of an anonymous request is NOT
    -- labelled as the requester (they were told their name would show).
    'is_requester', c.author_id = r.author_id and (not r.anonymous or c.anonymous),
    'anonymous', c.anonymous,
    'mine', c.author_id = p_viewer,
    'created_at', c.created_at, 'edited_at', c.edited_at);
$$;

create function prayer.update_json(u prayer.updates, r prayer.requests, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id, 'kind', u.kind, 'body', u.body,
    'author', case when r.anonymous then 'The requester' else community.display_name(u.author_id) end,
    'mine', u.author_id = p_viewer,
    'created_at', u.created_at, 'edited_at', u.edited_at);
$$;

-- Whether a reader may comment now.
create function prayer.can_comment(r prayer.requests, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select prayer.can_read(r, p_viewer) and r.audience <> 'private' and r.status in ('open', 'answered')
     and r.comments_enabled and not r.mod_locked and r.hidden_at is null
     and not community.restricted(p_viewer, 'posting');
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
-- p_view: feed | mine | following | answered
-- p_status: active (open + answered) | open | answered | closed | archived | all
-- p_audience: any | church | group | team | private
create function public.prayer_requests(
  p_view text default 'feed', p_status text default 'active', p_audience text default 'any', p_query text default null,
  p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_pattern text := case when nullif(btrim(coalesce(p_query, '')), '') is null then null else prayer.like_pattern(left(p_query, 100)) end;
  v_items jsonb;
begin
  if coalesce(p_view, '') not in ('feed', 'mine', 'following', 'answered')
     or coalesce(p_status, '') not in ('active', 'open', 'answered', 'closed', 'archived', 'all')
     or coalesce(p_audience, '') not in ('any', 'church', 'group', 'team', 'private') then
    raise exception 'Choose a valid filter.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(prayer.card(x, v_uid) order by x.last_activity_at desc, x.id desc), '[]'::jsonb)
    into v_items
    from (select r.* from prayer.requests r
           where prayer.can_read(r, v_uid)
             and case p_view
                   when 'mine' then r.author_id = v_uid
                   when 'following' then exists (select 1 from prayer.follows f where f.request_id = r.id and f.profile_id = v_uid)
                   when 'answered' then r.status = 'answered'
                   else true end
             -- Drafts appear only under My requests.
             and (p_view = 'mine' or r.audience <> 'private')
             and case when p_view = 'answered' then true
                      when p_status = 'active' then r.status in ('open', 'answered')
                      when p_status = 'all' then true
                      else r.status::text = p_status end
             and (p_audience = 'any' or r.audience::text = p_audience)
             and (v_pattern is null or r.title ilike v_pattern or r.body ilike v_pattern)
             and (p_before is null or (r.last_activity_at, r.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           order by r.last_activity_at desc, r.id desc
           limit v_limit) x;
  return jsonb_build_object('items', v_items, 'has_more', jsonb_array_length(v_items) = v_limit);
end;
$$;

create function public.prayer_request(p_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  r prayer.requests;
  v_comments jsonb;
  v_total integer;
begin
  select * into r from prayer.requests where id = p_id;
  if not found or not prayer.can_read(r, v_uid) then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  -- Confidential requests: record who opened them (not what they read).
  if r.audience = 'team' and r.author_id <> v_uid then
    perform prayer.log_access('team_request_viewed', 'prayer_request', r.id);
  end if;
  select count(*) into v_total from prayer.comments c
   where c.request_id = r.id and prayer.sees_item(r, c.posted_audience, c.posted_group, c.author_id, v_uid);
  select coalesce(jsonb_agg(prayer.comment_json(c, r, v_uid) order by c.created_at, c.id), '[]'::jsonb) into v_comments
    from (select * from prayer.comments c
           where c.request_id = r.id and prayer.sees_item(r, c.posted_audience, c.posted_group, c.author_id, v_uid)
           order by c.created_at, c.id limit v_limit) c;
  return prayer.card(r, v_uid) || jsonb_build_object(
    'body', r.body,
    'comments_enabled', r.comments_enabled,
    'mod_locked', r.mod_locked,
    'edited_at', r.edited_at, 'closed_at', r.closed_at, 'archived_at', r.archived_at,
    'audience_changed_at', r.audience_changed_at,
    'can_comment', prayer.can_comment(r, v_uid),
    'can_pray', r.audience <> 'private' and r.status in ('open', 'answered') and r.hidden_at is null,
    'posting_restricted', community.restricted(v_uid, 'posting'),
    'updates', coalesce((select jsonb_agg(prayer.update_json(u, r, v_uid) order by u.created_at, u.id)
                           from prayer.updates u
                          where u.request_id = r.id and prayer.sees_item(r, u.posted_audience, u.posted_group, u.author_id, v_uid)), '[]'::jsonb),
    'comments', v_comments,
    'comments_has_more', v_total > v_limit,
    -- Earlier items exist that this reader can't see (written for a smaller
    -- audience before it was widened). No count, no content.
    'withheld', exists (select 1 from prayer.comments c
                         where c.request_id = r.id and c.status <> 'deleted'
                           and not prayer.sees_item(r, c.posted_audience, c.posted_group, c.author_id, v_uid))
             or exists (select 1 from prayer.updates u
                         where u.request_id = r.id and not prayer.sees_item(r, u.posted_audience, u.posted_group, u.author_id, v_uid)),
    'can_moderate', public.has_capability('prayer.moderate') and prayer.in_audience(v_uid, r.audience, r.group_id),
    'can_lookup', r.anonymous and r.author_id <> v_uid and public.has_capability('prayer.identity'),
    'group_member', r.group_id is not null and community.group_member(r.group_id, v_uid));
end;
$$;

-- Groups the caller can share with (active groups they actively belong to).
create function public.prayer_my_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by lower(g.name))
                     from community.groups g
                    where g.status = 'active' and community.group_member(g.id, v_uid)), '[]'::jsonb);
end;
$$;

create function public.prayer_guidance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  return (select jsonb_build_object(
            'guidance', s.guidance,
            'is_team', prayer.holds(v_uid, 'prayer.confidential'),
            'can_moderate', prayer.holds(v_uid, 'prayer.moderate'),
            'can_coordinate', prayer.holds(v_uid, 'care.coordinate'),
            'can_assign', prayer.holds(v_uid, 'care.assign'),
            'posting_restricted', community.restricted(v_uid, 'posting'))
            from prayer.settings s);
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing requests
-- ---------------------------------------------------------------------------
-- Tidies after a request narrows, is hidden, or is archived: follows by
-- people who can no longer read it, and their queued/unread notices.
create function prayer.after_access_change(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from prayer.follows f
   using prayer.requests r
   where r.id = f.request_id and r.id = p_request and not prayer.can_read(r, f.profile_id);
  perform prayer.purge_notices(p_request);
end;
$$;

-- Create (p_id null) or edit. Audience: private | group | team | church.
-- Publishing or widening needs p_confirm = the new audience.
create function public.prayer_request_save(
  p_id uuid, p_title text, p_body text, p_audience text, p_group uuid,
  p_anonymous boolean, p_comments_enabled boolean, p_confirm text default null, p_client_key uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_title text := community.clean_text(p_title, 3, 120, 'The title');
  v_body text := community.clean_text(p_body, 1, 4000, 'Your request');
  v_aud prayer.audience;
  v_group uuid;
  r prayer.requests;
  v_id uuid;
  v_changed boolean;
begin
  if coalesce(p_audience, '') not in ('private', 'group', 'team', 'church') then
    raise exception 'Choose who can see your request.' using errcode = '22023';
  end if;
  v_aud := p_audience::prayer.audience;
  v_group := case when v_aud = 'group' then p_group end;
  if v_aud = 'group' and not (v_group is not null and community.group_member(v_group, v_uid)
                              and exists (select 1 from community.groups where id = v_group and status = 'active')) then
    raise exception 'Choose one of your active groups.' using errcode = '22023';
  end if;
  if v_aud <> 'private' and community.restricted(v_uid, 'posting') then
    raise exception 'Your community posting is paused by a moderator, so you can save a private draft only.' using errcode = '42501';
  end if;

  if p_id is null then
    if p_client_key is not null then
      select id into v_id from prayer.requests where author_id = v_uid and client_key = p_client_key;
      if found then
        return v_id;
      end if;
    end if;
    if v_aud <> 'private' and p_confirm is distinct from v_aud::text then
      raise exception 'Please confirm who will see your request before sharing it.' using errcode = '22023';
    end if;
    perform community.rate_limit(v_uid, 'prayer_request', 5, interval '1 hour');
    insert into prayer.requests (author_id, audience, group_id, title, body, anonymous, comments_enabled, client_key, published_at)
    values (v_uid, v_aud, v_group, v_title, v_body, coalesce(p_anonymous, false), coalesce(p_comments_enabled, true),
            p_client_key, case when v_aud <> 'private' then now() end)
    returning id into v_id;
    insert into prayer.follows (request_id, profile_id) values (v_id, v_uid);
    perform prayer.audit('prayer.request_created', 'prayer_request', v_id, jsonb_build_object('audience', v_aud, 'anonymous', coalesce(p_anonymous, false)));
    return v_id;
  end if;

  select * into r from prayer.requests where id = p_id for update;
  if not found or r.author_id <> v_uid then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  if r.status = 'archived' then
    raise exception 'Restore this request from the archive before editing it.' using errcode = '22023';
  end if;
  v_changed := v_aud <> r.audience or v_group is distinct from r.group_id;
  if v_changed and not prayer.is_narrowing(r.audience, r.group_id, v_aud, v_group) and p_confirm is distinct from v_aud::text then
    raise exception 'Please confirm the new, wider audience before saving.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'prayer_edit', 30, interval '15 minutes');
  update prayer.requests
     set title = v_title, body = v_body,
         anonymous = coalesce(p_anonymous, anonymous),
         comments_enabled = coalesce(p_comments_enabled, comments_enabled),
         audience = v_aud, group_id = v_group,
         audience_changed_at = case when v_changed then now() else audience_changed_at end,
         published_at = coalesce(published_at, case when v_aud <> 'private' then now() end),
         edited_at = case when v_title <> r.title or v_body <> r.body then now() else edited_at end
   where id = r.id;
  -- Becoming anonymous also hides the name on the requester's own earlier comments.
  if coalesce(p_anonymous, r.anonymous) and not r.anonymous then
    update prayer.comments set anonymous = true where request_id = r.id and author_id = v_uid and status <> 'deleted';
  end if;
  if v_changed then
    perform prayer.after_access_change(r.id);
    perform prayer.audit('prayer.audience_changed', 'prayer_request', r.id,
      jsonb_build_object('from', r.audience, 'to', v_aud, 'narrowed', prayer.is_narrowing(r.audience, r.group_id, v_aud, v_group)));
  end if;
  return r.id;
end;
$$;

-- Notify followers (and the author) of new activity they can see.
create function prayer.notify_followers(r prayer.requests, p_kind text, p_actor uuid, p_include_author boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f uuid;
begin
  if p_include_author and r.author_id <> p_actor and prayer.can_read(r, r.author_id) then
    perform community.notify(r.author_id, p_kind, null,
      jsonb_build_object('prayer_request_id', r.id, 'detail', jsonb_build_object('mine', true)),
      'prayer:' || r.id || ':' || p_kind);
  end if;
  for v_f in
    select f.profile_id from prayer.follows f
     where f.request_id = r.id and f.profile_id <> p_actor and f.profile_id <> r.author_id
       and prayer.can_read(r, f.profile_id)
  loop
    perform community.notify(v_f, p_kind, null, jsonb_build_object('prayer_request_id', r.id), 'prayer:' || r.id || ':' || p_kind);
  end loop;
end;
$$;

-- open | answered | closed | archived. Restoring from the archive widens
-- the audience again, so it needs p_confirm = the request's audience.
create function public.prayer_request_status(p_id uuid, p_status text, p_confirm text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  r prayer.requests;
begin
  if coalesce(p_status, '') not in ('open', 'answered', 'closed', 'archived') then
    raise exception 'Choose a status.' using errcode = '22023';
  end if;
  select * into r from prayer.requests where id = p_id for update;
  if not found or r.author_id <> v_uid then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  if r.status::text = p_status then
    return;
  end if;
  if r.status = 'archived' and r.audience <> 'private' and p_confirm is distinct from r.audience::text then
    raise exception 'Please confirm who will see this request again before restoring it.' using errcode = '22023';
  end if;
  update prayer.requests
     set status = p_status::prayer.request_status,
         answered_at = case when p_status = 'answered' then coalesce(answered_at, now()) else answered_at end,
         closed_at = case when p_status in ('closed', 'archived') then coalesce(closed_at, now()) else null end,
         archived_at = case when p_status = 'archived' then now() end,
         last_activity_at = case when p_status = 'answered' then now() else last_activity_at end
   where id = r.id
  returning * into r;
  if p_status = 'archived' then
    perform prayer.after_access_change(r.id);
  elsif p_status = 'answered' and r.audience <> 'private' then
    perform prayer.notify_followers(r, 'prayer_answered', v_uid, false);
  end if;
  perform prayer.audit('prayer.status_changed', 'prayer_request', r.id, jsonb_build_object('to', p_status));
end;
$$;

-- Author deletion: the request, its updates, comments, prayers, follows,
-- and notifications are deleted. Evidence in already-closed reports about
-- it is cleared at once; open reports keep their snapshot until resolved.
create function public.prayer_request_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  r prayer.requests;
begin
  select * into r from prayer.requests where id = p_id for update;
  if not found or r.author_id <> v_uid then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  update prayer.reports set evidence = null, evidence_cleared_at = now()
   where request_id = r.id and status in ('actioned', 'dismissed') and evidence is not null;
  delete from prayer.requests where id = r.id;
  perform prayer.audit('prayer.request_deleted', 'prayer_request', r.id, '{}'::jsonb);
end;
$$;

create function public.prayer_set_comments(p_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  update prayer.requests set comments_enabled = coalesce(p_enabled, false)
   where id = p_id and author_id = v_uid and status <> 'archived';
  if not found then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Updates (author)
-- ---------------------------------------------------------------------------
create function public.prayer_update_add(p_id uuid, p_body text, p_answered boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  r prayer.requests;
  v_id uuid;
  v_body text := community.clean_text(p_body, 1, 2000, 'Your update');
begin
  select * into r from prayer.requests where id = p_id for update;
  if not found or r.author_id <> v_uid then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  if r.audience = 'private' then
    raise exception 'Share your request before adding updates.' using errcode = '22023';
  end if;
  if r.status = 'archived' then
    raise exception 'Restore this request from the archive before adding updates.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'prayer_update', 10, interval '1 hour');
  insert into prayer.updates (request_id, author_id, kind, body, posted_audience, posted_group)
  values (r.id, v_uid, case when p_answered then 'answered' else 'update' end, v_body, r.audience, r.group_id)
  returning id into v_id;
  update prayer.requests
     set last_activity_at = now(),
         status = case when p_answered then 'answered'::prayer.request_status else status end,
         answered_at = case when p_answered then coalesce(answered_at, now()) else answered_at end,
         closed_at = case when p_answered then null else closed_at end
   where id = r.id
  returning * into r;
  if r.hidden_at is null then
    perform prayer.notify_followers(r, case when p_answered then 'prayer_answered' else 'prayer_update' end, v_uid, false);
  end if;
  return v_id;
end;
$$;

create function public.prayer_update_edit(p_update uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  perform community.rate_limit(v_uid, 'prayer_edit', 30, interval '15 minutes');
  update prayer.updates u set body = community.clean_text(p_body, 1, 2000, 'Your update'), edited_at = now()
    from prayer.requests r
   where u.id = p_update and r.id = u.request_id and u.author_id = v_uid and r.author_id = v_uid and r.status <> 'archived';
  if not found then
    raise exception 'That update wasn''t found.' using errcode = 'P0002';
  end if;
end;
$$;

create function public.prayer_update_delete(p_update uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  delete from prayer.updates u using prayer.requests r
   where u.id = p_update and r.id = u.request_id and u.author_id = v_uid and r.author_id = v_uid;
  if not found then
    raise exception 'That update wasn''t found.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
-- p_named only matters for the requester of an anonymous request: by
-- default their comments show as "The requester"; with p_named their name
-- shows (the app explains this before they post).
create function public.prayer_comment_add(p_request uuid, p_body text, p_named boolean default false, p_client_key uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  r prayer.requests;
  v_id uuid;
  v_body text := community.clean_text(p_body, 1, 2000, 'Your comment');
begin
  -- Lock the request so lock/hide/audience changes and comments serialize.
  select * into r from prayer.requests where id = p_request for update;
  if not found or not prayer.can_read(r, v_uid) then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  if p_client_key is not null then
    select id into v_id from prayer.comments where request_id = r.id and author_id = v_uid and client_key = p_client_key;
    if found then
      return v_id;
    end if;
  end if;
  if community.restricted(v_uid, 'posting') then
    raise exception 'Your community posting is paused by a moderator. You can still read and pray.' using errcode = '42501';
  end if;
  if not prayer.can_comment(r, v_uid) then
    raise exception 'Comments are closed on this request.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'prayer_comment', 20, interval '15 minutes');
  insert into prayer.comments (request_id, author_id, body, anonymous, posted_audience, posted_group, client_key)
  values (r.id, v_uid, v_body, r.author_id = v_uid and r.anonymous and not coalesce(p_named, false),
          r.audience, r.group_id, p_client_key)
  returning id into v_id;
  update prayer.requests set last_activity_at = now() where id = r.id;
  insert into prayer.follows (request_id, profile_id) values (r.id, v_uid) on conflict do nothing;
  perform prayer.notify_followers(r, 'prayer_comment', v_uid, true);
  return v_id;
end;
$$;

create function public.prayer_comment_edit(p_comment uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  c prayer.comments;
  r prayer.requests;
begin
  select * into c from prayer.comments where id = p_comment for update;
  select * into r from prayer.requests where id = c.request_id;
  if c.id is null or c.author_id <> v_uid or not prayer.can_read(r, v_uid) then
    raise exception 'That comment wasn''t found.' using errcode = 'P0002';
  end if;
  if c.status <> 'visible' or r.mod_locked or r.hidden_at is not null then
    raise exception 'This comment can''t be edited.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'prayer_edit', 30, interval '15 minutes');
  update prayer.comments set body = community.clean_text(p_body, 1, 2000, 'Your comment'), edited_at = now() where id = c.id;
end;
$$;

-- Leaves a "deleted" placeholder; the text is erased in the same statement.
create function public.prayer_comment_delete(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  update prayer.comments set status = 'deleted', body = '', deleted_at = now()
   where id = p_comment and author_id = v_uid and status <> 'deleted';
  if not found then
    raise exception 'That comment wasn''t found.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Praying and following
-- ---------------------------------------------------------------------------
create function public.prayer_pray(p_request uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  r prayer.requests;
begin
  select * into r from prayer.requests where id = p_request;
  if not found or not prayer.can_read(r, v_uid) then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  if p_on then
    if r.audience = 'private' or r.status not in ('open', 'answered') or r.hidden_at is not null then
      raise exception 'This request isn''t taking prayers right now.' using errcode = '22023';
    end if;
    perform community.rate_limit(v_uid, 'prayer_pray', 60, interval '15 minutes');
    insert into prayer.prayers (request_id, profile_id) values (r.id, v_uid) on conflict do nothing;
  else
    delete from prayer.prayers where request_id = r.id and profile_id = v_uid;
  end if;
  return jsonb_build_object(
    'count', (select count(*) from prayer.prayers where request_id = r.id),
    'praying', exists (select 1 from prayer.prayers where request_id = r.id and profile_id = v_uid));
end;
$$;

create function public.prayer_follow(p_request uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
begin
  if not prayer.can_read_id(p_request, v_uid) then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  if p_on then
    insert into prayer.follows (request_id, profile_id) values (p_request, v_uid) on conflict do nothing;
  else
    delete from prayer.follows where request_id = p_request and profile_id = v_uid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports (only the reported item is captured)
-- ---------------------------------------------------------------------------
create function public.prayer_report(p_type text, p_id uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  r prayer.requests;
  c prayer.comments;
  u prayer.updates;
  v_author uuid;
  v_anon boolean;
  v_evidence jsonb;
  v_id uuid;
begin
  if coalesce(p_reason, '') not in ('inappropriate', 'privacy', 'spam', 'harassment', 'safety', 'other') then
    raise exception 'Choose a reason.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'prayer_report', 10, interval '1 hour');
  if p_type = 'request' then
    select * into r from prayer.requests where id = p_id;
    if not found or not prayer.can_read(r, v_uid) or r.audience = 'private' then
      raise exception 'That wasn''t found.' using errcode = 'P0002';
    end if;
    v_author := r.author_id;
    v_anon := r.anonymous;
    v_evidence := jsonb_build_object('type', 'request', 'title', r.title, 'body', r.body,
                                     'author', prayer.author_label(r, null), 'created_at', r.created_at, 'edited_at', r.edited_at);
  elsif p_type = 'comment' then
    select * into c from prayer.comments where id = p_id;
    select * into r from prayer.requests where id = c.request_id;
    if c.id is null or c.status <> 'visible' or not prayer.sees_item(r, c.posted_audience, c.posted_group, c.author_id, v_uid) then
      raise exception 'That wasn''t found.' using errcode = 'P0002';
    end if;
    v_author := c.author_id;
    v_anon := c.anonymous;
    v_evidence := jsonb_build_object('type', 'comment', 'body', c.body,
                                     'author', case when c.anonymous then 'The requester' else community.display_name(c.author_id) end,
                                     'created_at', c.created_at, 'edited_at', c.edited_at);
  elsif p_type = 'update' then
    select * into u from prayer.updates where id = p_id;
    select * into r from prayer.requests where id = u.request_id;
    if u.id is null or not prayer.sees_item(r, u.posted_audience, u.posted_group, u.author_id, v_uid) then
      raise exception 'That wasn''t found.' using errcode = 'P0002';
    end if;
    v_author := u.author_id;
    v_anon := r.anonymous;
    v_evidence := jsonb_build_object('type', 'update', 'body', u.body,
                                     'author', case when r.anonymous then 'The requester' else community.display_name(u.author_id) end,
                                     'created_at', u.created_at, 'edited_at', u.edited_at);
  else
    raise exception 'That can''t be reported.' using errcode = '22023';
  end if;
  if v_author = v_uid then
    raise exception 'You can edit or delete your own words instead of reporting them.' using errcode = '22023';
  end if;
  select id into v_id from prayer.reports
   where reporter_id = v_uid and target_type = p_type and target_id = p_id and status in ('open', 'reviewing');
  if v_id is not null then
    return v_id;
  end if;
  insert into prayer.reports (reporter_id, target_type, target_id, request_id, audience, reported_profile_id,
                              reported_anonymous, reason, details, evidence)
  values (v_uid, p_type, p_id, r.id, r.audience, v_author, v_anon, p_reason,
          nullif(community.clean_text(coalesce(p_details, ''), 0, 1000, 'The details'), ''), v_evidence)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation (prayer.moderate, within scope)
-- ---------------------------------------------------------------------------
-- A report is reviewable by prayer moderators; confidential (team) ones only
-- by moderators who also hold prayer.confidential. Never by the reporter
-- or the reported person.
create function prayer.can_review(rep prayer.reports)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_capability('prayer.moderate')
     and rep.reporter_id is distinct from (select auth.uid())
     and rep.reported_profile_id is distinct from (select auth.uid())
     and ((rep.audience <> 'team'
           and coalesce((select r.audience <> 'team' from prayer.requests r where r.id = rep.request_id), true))
          or public.has_capability('prayer.confidential'));
$$;

-- Moderation scope for a request: a reviewable open report about it (or one
-- of its comments), or a request the moderator is in the audience of.
create function prayer.can_moderate(r prayer.requests, p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_capability('prayer.moderate')
     and r.author_id <> (select auth.uid())
     and ((p_report is not null and exists (
             select 1 from prayer.reports rep
              where rep.id = p_report and rep.request_id = r.id and rep.status in ('open', 'reviewing') and prayer.can_review(rep)))
          or prayer.in_audience((select auth.uid()), r.audience, r.group_id));
$$;

create function public.prayer_mod_reports(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_capability('prayer.moderate');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', rep.id, 'target_type', rep.target_type, 'reason', rep.reason, 'status', rep.status,
             'audience', rep.audience, 'created_at', rep.created_at,
             'reported', case when rep.reported_anonymous then 'Anonymous' else community.display_name(rep.reported_profile_id) end)
           order by rep.created_at)
      from prayer.reports rep
     where case when p_status = 'closed' then rep.status in ('actioned', 'dismissed') else rep.status in ('open', 'reviewing') end
       and prayer.can_review(rep)), '[]'::jsonb);
end;
$$;

create function public.prayer_mod_report(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('prayer.moderate');
  rep prayer.reports;
  r prayer.requests;
begin
  select * into rep from prayer.reports where id = p_id;
  if not found or not prayer.can_review(rep) then
    raise exception 'That report wasn''t found.' using errcode = 'P0002';
  end if;
  perform prayer.mod_log('report.viewed', rep.id, rep.target_type, rep.target_id);
  perform prayer.log_access('report_viewed', 'prayer_report', rep.id);
  if rep.status = 'open' then
    update prayer.reports set status = 'reviewing', updated_at = now() where id = rep.id;
  end if;
  select * into r from prayer.requests where id = rep.request_id;
  return jsonb_build_object(
    'id', rep.id, 'target_type', rep.target_type, 'target_id', rep.target_id, 'reason', rep.reason, 'details', rep.details,
    'status', case when rep.status = 'open' then 'reviewing' else rep.status end,
    'audience', rep.audience, 'resolution', rep.resolution, 'resolved_at', rep.resolved_at,
    'resolved_by', case when rep.resolved_by is null then null else community.display_name(rep.resolved_by) end,
    'created_at', rep.created_at,
    'reporter', community.display_name(rep.reporter_id),
    'reported', case when rep.reported_anonymous then 'Anonymous' else community.display_name(rep.reported_profile_id) end,
    'reported_anonymous', rep.reported_anonymous,
    'evidence', rep.evidence,
    'evidence_cleared_at', rep.evidence_cleared_at,
    'request_exists', r.id is not null,
    'request_id', r.id,
    -- Whether the moderator could open the request as an ordinary reader.
    'can_open', r.id is not null and prayer.can_read(r, v_uid),
    -- Current state of the reported item (not its text).
    'current', case when r.id is null then null
                    when rep.target_type = 'request' then jsonb_build_object('hidden', r.hidden_at is not null, 'mod_locked', r.mod_locked, 'status', r.status)
                    when rep.target_type = 'comment' then (select jsonb_build_object('status', c.status, 'mod_locked', r.mod_locked)
                                                             from prayer.comments c where c.id = rep.target_id)
                    else jsonb_build_object('exists', exists (select 1 from prayer.updates u where u.id = rep.target_id),
                                            'hidden', r.hidden_at is not null) end,
    'can_lookup', rep.reported_anonymous and r.id is not null and public.has_capability('prayer.identity'),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'actor', community.display_name(l.actor_id),
                                                         'reason', l.reason, 'at', l.created_at) order by l.created_at)
                       from prayer.moderation_log l where l.report_id = rep.id), '[]'::jsonb));
end;
$$;

create function public.prayer_mod_resolve(p_id uuid, p_status text, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep prayer.reports;
begin
  perform prayer.require_capability('prayer.moderate');
  select * into rep from prayer.reports where id = p_id for update;
  if not found or not prayer.can_review(rep) then
    raise exception 'That report wasn''t found.' using errcode = 'P0002';
  end if;
  if coalesce(p_status, '') not in ('actioned', 'dismissed', 'open') then
    raise exception 'Choose an outcome.' using errcode = '22023';
  end if;
  if p_status <> 'open' and char_length(btrim(coalesce(p_resolution, ''))) < 3 then
    raise exception 'Record what was decided.' using errcode = '22023';
  end if;
  update prayer.reports
     set status = p_status,
         resolution = case when p_status = 'open' then resolution else left(btrim(p_resolution), 1000) end,
         resolved_by = case when p_status = 'open' then null else (select auth.uid()) end,
         resolved_at = case when p_status = 'open' then null else now() end,
         updated_at = now()
   where id = rep.id;
  perform prayer.mod_log(case p_status when 'open' then 'report.reopened' else 'report.' || p_status end,
                         rep.id, rep.target_type, rep.target_id, p_resolution);
  perform prayer.audit('prayer.report_' || case p_status when 'open' then 'reopened' else p_status end, 'prayer_report', rep.id, '{}'::jsonb);
end;
$$;

-- p_type: request (hide | restore | lock | unlock) or comment (hide | restore).
create function public.prayer_mod_action(p_type text, p_id uuid, p_action text, p_reason text, p_report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('prayer.moderate');
  r prayer.requests;
  c prayer.comments;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason.' using errcode = '22023';
  end if;
  if p_type = 'comment' then
    select * into c from prayer.comments where id = p_id for update;
    select * into r from prayer.requests where id = c.request_id for update;
  elsif p_type = 'request' then
    select * into r from prayer.requests where id = p_id for update;
  else
    raise exception 'Unknown item.' using errcode = '22023';
  end if;
  if r.id is null or not prayer.can_moderate(r, p_report) then
    raise exception 'You do not have permission to moderate this.' using errcode = '42501';
  end if;
  if p_type = 'comment' then
    if p_action = 'hide' and c.status = 'visible' then
      update prayer.comments set status = 'hidden', hidden_at = now(), hidden_by = v_uid where id = c.id;
    elsif p_action = 'restore' and c.status = 'hidden' then
      update prayer.comments set status = 'visible', hidden_at = null, hidden_by = null where id = c.id;
    else
      raise exception 'That action doesn''t apply to this comment.' using errcode = '22023';
    end if;
    perform community.notify(c.author_id, 'prayer_moderation', null,
      jsonb_build_object('prayer_request_id', r.id,
                         'detail', jsonb_build_object('action', case p_action when 'hide' then 'hidden' else 'restored' end,
                                                      'target', 'comment', 'reason', left(p_reason, 300))));
  else
    case p_action
      when 'hide' then
        if r.hidden_at is not null then
          raise exception 'This request is already hidden.' using errcode = '22023';
        end if;
        update prayer.requests set hidden_at = now(), hidden_by = v_uid where id = r.id;
        perform prayer.purge_notices(r.id);
      when 'restore' then
        if r.hidden_at is null then
          raise exception 'This request isn''t hidden.' using errcode = '22023';
        end if;
        update prayer.requests set hidden_at = null, hidden_by = null where id = r.id;
      when 'lock' then
        update prayer.requests set mod_locked = true where id = r.id;
      when 'unlock' then
        update prayer.requests set mod_locked = false where id = r.id;
      else
        raise exception 'Unknown action.' using errcode = '22023';
    end case;
    perform community.notify(r.author_id, 'prayer_moderation', null,
      jsonb_build_object('prayer_request_id', r.id,
                         'detail', jsonb_build_object('action', case p_action when 'hide' then 'hidden' when 'restore' then 'restored'
                                                                               when 'lock' then 'locked' else 'unlocked' end,
                                                      'target', 'request', 'reason', left(p_reason, 300))));
  end if;
  perform prayer.mod_log(p_type || '.' || p_action, p_report, p_type, p_id, p_reason);
  perform prayer.audit('prayer.' || p_type || '_' || p_action, 'prayer_' || p_type, p_id, jsonb_build_object('report', p_report));
end;
$$;

create function public.prayer_mod_log(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_capability('prayer.moderate');
  return coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'actor', community.display_name(l.actor_id),
                                                       'target_type', l.target_type, 'reason', l.reason, 'at', l.created_at)
                                    order by l.created_at desc)
                     from (select * from prayer.moderation_log order by created_at desc
                            limit least(greatest(coalesce(p_limit, 100), 1), 200)) l), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity lookup for anonymous requests (prayer.identity): scoped to a
-- request the caller can read, or one with a report they can review; a
-- reason is required; every lookup is recorded (access log + audit log,
-- reference and reason only). Returns the display name only.
-- ---------------------------------------------------------------------------
create function public.prayer_identity_lookup(p_request uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_capability('prayer.identity');
  r prayer.requests;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Record why you need to know who wrote this (at least 10 characters).' using errcode = '22023';
  end if;
  select * into r from prayer.requests where id = p_request;
  if not found or not r.anonymous or r.author_id = v_uid
     or not (prayer.can_read(r, v_uid)
             or exists (select 1 from prayer.reports rep
                         where rep.request_id = r.id and rep.status in ('open', 'reviewing') and prayer.can_review(rep))) then
    raise exception 'That prayer request wasn''t found.' using errcode = 'P0002';
  end if;
  perform prayer.log_access('identity_lookup', 'prayer_request', r.id, btrim(p_reason));
  perform prayer.audit('prayer.identity_lookup', 'prayer_request', r.id, '{}'::jsonb);
  return jsonb_build_object('name', community.display_name(r.author_id));
end;
$$;

-- Sensitive-access records, for prayer/care leads' oversight.
create function public.prayer_access_log(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform prayer.require_capability('prayer.identity');
  return coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'actor', community.display_name(l.actor_id),
                                                       'target_type', l.target_type, 'reason', l.reason, 'at', l.created_at)
                                    order by l.created_at desc)
                     from (select * from prayer.access_log order by created_at desc
                            limit least(greatest(coalesce(p_limit, 100), 1), 200)) l), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings (settings.manage): guidance text and retention policy. No
-- request content is reachable from here.
-- ---------------------------------------------------------------------------
create function public.prayer_admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_capability('settings.manage') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return (select to_jsonb(s) - 'id' from prayer.settings s);
end;
$$;

create function public.prayer_admin_save_settings(
  p_guidance text, p_retention_enabled boolean, p_closed_archive_days integer, p_archived_delete_days integer,
  p_care_delete_days integer, p_report_evidence_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old prayer.settings;
begin
  if not public.has_capability('settings.manage') then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  select * into old from prayer.settings;
  update prayer.settings
     set guidance = community.clean_text(p_guidance, 1, 4000, 'The guidance'),
         retention_enabled = coalesce(p_retention_enabled, false),
         closed_archive_days = p_closed_archive_days,
         archived_delete_days = p_archived_delete_days,
         care_delete_days = p_care_delete_days,
         report_evidence_days = p_report_evidence_days,
         updated_at = now(), updated_by = (select auth.uid())
   where id;
  perform community.audit('prayer.settings_updated', 'prayer_settings', 'singleton',
    jsonb_build_object('retention_enabled', coalesce(p_retention_enabled, false),
                       'retention_changed', coalesce(p_retention_enabled, false) is distinct from old.retention_enabled));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema prayer from public, anon, authenticated;

revoke execute on function
  public.prayer_requests(text, text, text, text, timestamptz, uuid, integer), public.prayer_request(uuid, integer),
  public.prayer_my_groups(), public.prayer_guidance(),
  public.prayer_request_save(uuid, text, text, text, uuid, boolean, boolean, text, uuid),
  public.prayer_request_status(uuid, text, text), public.prayer_request_delete(uuid), public.prayer_set_comments(uuid, boolean),
  public.prayer_update_add(uuid, text, boolean), public.prayer_update_edit(uuid, text), public.prayer_update_delete(uuid),
  public.prayer_comment_add(uuid, text, boolean, uuid), public.prayer_comment_edit(uuid, text), public.prayer_comment_delete(uuid),
  public.prayer_pray(uuid, boolean), public.prayer_follow(uuid, boolean), public.prayer_report(text, uuid, text, text),
  public.prayer_mod_reports(text), public.prayer_mod_report(uuid), public.prayer_mod_resolve(uuid, text, text),
  public.prayer_mod_action(text, uuid, text, text, uuid), public.prayer_mod_log(integer),
  public.prayer_identity_lookup(uuid, text), public.prayer_access_log(integer),
  public.prayer_admin_settings(), public.prayer_admin_save_settings(text, boolean, integer, integer, integer, integer)
from public, anon;

grant execute on function
  public.prayer_requests(text, text, text, text, timestamptz, uuid, integer), public.prayer_request(uuid, integer),
  public.prayer_my_groups(), public.prayer_guidance(),
  public.prayer_request_save(uuid, text, text, text, uuid, boolean, boolean, text, uuid),
  public.prayer_request_status(uuid, text, text), public.prayer_request_delete(uuid), public.prayer_set_comments(uuid, boolean),
  public.prayer_update_add(uuid, text, boolean), public.prayer_update_edit(uuid, text), public.prayer_update_delete(uuid),
  public.prayer_comment_add(uuid, text, boolean, uuid), public.prayer_comment_edit(uuid, text), public.prayer_comment_delete(uuid),
  public.prayer_pray(uuid, boolean), public.prayer_follow(uuid, boolean), public.prayer_report(text, uuid, text, text),
  public.prayer_mod_reports(text), public.prayer_mod_report(uuid), public.prayer_mod_resolve(uuid, text, text),
  public.prayer_mod_action(text, uuid, text, text, uuid), public.prayer_mod_log(integer),
  public.prayer_identity_lookup(uuid, text), public.prayer_access_log(integer),
  public.prayer_admin_settings(), public.prayer_admin_save_settings(text, boolean, integer, integer, integer, integer)
to authenticated;
