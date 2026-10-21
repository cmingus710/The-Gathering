-- Phase 10 · Step 7 of 9: apply migration 20261028000700_youth_communication_learning to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Youth announcements, supervised discussions, reports, learning assignments, the youth home, guardian-led practice for child profiles, and progress summaries.
--
-- It copies supabase/migrations/20261028000700_youth_communication_learning.sql verbatim and records it in
-- the migration history under its repository version (created_by = phase-10).
-- All or nothing: one transaction. A failed run leaves nothing behind and can
-- be rerun; running it out of order, or again after success, stops at the
-- preflight check with "Nothing was changed".
begin;

do $preflight$
begin
  if to_regclass('youth.children') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000600') then
    raise exception 'Nothing was changed: the previous step (20261028000600) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000700') then
    raise exception 'Nothing was changed: 20261028000700 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261028000700_youth_communication_learning.sql
-- =========================================================================
-- Phase 10 · Youth announcements, supervised discussions, reports, learning
-- assignments, guardian-led practice for child profiles, and progress views.
--
-- Communication rules
--   * There is no private messaging of any kind here: no adult↔youth or
--     youth↔youth direct messages, no one-person groups, no replies by
--     notification or profile action. Discussions belong to a youth group
--     and are always visible to every leader of that group (and, when the
--     policy says so, to guardians of enrolled children). Leaders can't
--     narrow a discussion's audience; there is no audience field.
--   * Discussions are off until the approved policy allows them. Posting
--     needs the policy's number of effective leaders in the group and at
--     least three enrolled children (so a discussion can't be used as a
--     private channel). Only leaders start discussions; youth reply.
--   * Group prayer threads need the policy's group_prayer setting.
--     Confidential youth care is not offered (see docs/youth-family-admin-guide.md).
--   * Reports about a leader's post are reviewed by safeguarding reviewers
--     who don't lead that group; leaders never see reports about themselves.
--
-- Learning rules
--   * Leaders allowed to publish (or youth.publish holders) assign church-wide
--     memory collections, reading plans, or teaching items to a youth group.
--   * A guardian allowed to practice runs practice for a child profile; it is
--     recorded on the child (youth.practice_*), never on the guardian.
--   * Guardians see progress summaries only: never typed answers, journal
--     entries, or reflections. For an independent youth, only when the
--     policy offers sharing and the youth switched it on.

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create function youth.can_publish(p_group uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_capability('youth.publish')
      or (p_group is not null and youth.leader_may(p_group, p_profile, 'publish'));
$$;

create function youth.announcement_visible(a youth.announcements, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a.status = 'published' and a.publish_at <= now()
     and (a.group_id is null or exists (select 1 from youth.groups g where g.id = a.group_id and g.status = 'active'))
     and (
       (a.group_id is not null and youth.is_leader(a.group_id, p_profile))
       or (a.group_id is null and exists (select 1 from youth.group_leaders l where l.profile_id = p_profile and l.status = 'active'
                                             and youth.is_leader(l.group_id, p_profile)))
       or (a.to_youth and youth.is_active_youth(p_profile)
           and (a.group_id is null or youth.youth_in_group(a.group_id, p_profile))
           and (a.group_id is not null or exists (select 1 from youth.enrollments e where e.child_id = youth.account_child(p_profile) and e.status = 'active')))
       or (a.to_guardians and youth.is_adult(p_profile)
           and ((a.group_id is not null and youth.guardian_in_group(a.group_id, p_profile, 'receive_updates'))
                or (a.group_id is null and exists (select 1 from youth.enrollments e join youth.guardianships g on g.child_id = e.child_id
                                                    where e.status = 'active' and g.guardian_id = p_profile and g.status = 'verified'
                                                      and youth.guardian_can(e.child_id, p_profile, 'receive_updates'))))));
$$;

create function youth.announcement_json(a youth.announcements, p_manage boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'group_id', a.group_id, 'group', (select g.name from youth.groups g where g.id = a.group_id),
    'title', a.title, 'body', a.body, 'to_youth', a.to_youth, 'to_guardians', a.to_guardians,
    'status', a.status, 'publish_at', a.publish_at,
    'author', case when a.published_by is not null then community.display_name(a.published_by) end,
    'updated_at', case when p_manage then a.updated_at end);
$$;

create function public.youth_announcements(p_group uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (youth.is_adult(v_uid) or youth.is_active_youth(v_uid)) then
    raise exception 'Only approved members can do that.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(youth.announcement_json(a, false) order by a.publish_at desc)
     from (select * from youth.announcements a
            where (p_group is null or a.group_id = p_group or a.group_id is null) and youth.announcement_visible(a, v_uid)
            order by a.publish_at desc limit 50) a), '[]'::jsonb);
end;
$$;

-- Announcements the caller may manage.
create function public.youth_manage_announcements()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  return coalesce((select jsonb_agg(youth.announcement_json(a, true) order by a.status = 'archived', coalesce(a.publish_at, a.created_at) desc)
     from (select * from youth.announcements a
            where youth.can_publish(a.group_id, v_uid) order by a.created_at desc limit 200) a), '[]'::jsonb);
end;
$$;

-- {group_id (null = every group, youth.publish only), title, body, to_youth, to_guardians}
create function public.youth_announcement_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  a youth.announcements;
begin
  perform community.rate_limit(v_uid, 'youth_announcement', 60, interval '1 hour');
  if not youth.can_publish(v_group, v_uid) or (v_group is not null and not exists (select 1 from youth.groups where id = v_group and status = 'active')) then
    raise exception 'You can''t publish to that group.' using errcode = '42501';
  end if;
  if btrim(coalesce(p ->> 'title', '')) = '' or char_length(p ->> 'title') > 160 or char_length(coalesce(p ->> 'body', '')) > 5000 then
    raise exception 'Enter a title (160 characters or fewer) and a shorter message.' using errcode = '22023';
  end if;
  if not (coalesce((p ->> 'to_youth')::boolean, false) or coalesce((p ->> 'to_guardians')::boolean, false)) then
    raise exception 'Choose who the announcement is for.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into youth.announcements (group_id, title, body, to_youth, to_guardians, created_by)
    values (v_group, btrim(p ->> 'title'), coalesce(p ->> 'body', ''), coalesce((p ->> 'to_youth')::boolean, false),
            coalesce((p ->> 'to_guardians')::boolean, false), v_uid)
    returning * into a;
  else
    select * into a from youth.announcements where id = p_id for update;
    if a.id is null or not youth.can_publish(a.group_id, v_uid) then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
    if a.status <> 'draft' then
      raise exception 'Published announcements can''t be edited. Archive it and post a correction.' using errcode = '22023';
    end if;
    update youth.announcements
       set group_id = v_group, title = btrim(p ->> 'title'), body = coalesce(p ->> 'body', ''),
           to_youth = coalesce((p ->> 'to_youth')::boolean, false), to_guardians = coalesce((p ->> 'to_guardians')::boolean, false)
     where id = a.id
    returning * into a;
  end if;
  return youth.announcement_json(a, true);
end;
$$;

-- Notifies guardians (allowed to receive updates) once, when it goes live.
create function youth.announce(a youth.announcements)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if a.to_guardians then
    perform youth.notify(x.guardian_id, 'youth_announcement', jsonb_build_object('youth_announcement_id', a.id), 'youth_ann:' || a.id)
       from (select distinct g.guardian_id from youth.enrollments e join youth.guardianships g on g.child_id = e.child_id
              where e.status = 'active' and (a.group_id is null or e.group_id = a.group_id)
                and g.status = 'verified' and g.can_receive_updates and youth.guardian_can(e.child_id, g.guardian_id, 'receive_updates')) x;
  end if;
  update youth.announcements set notified_at = now() where id = a.id;
end;
$$;

create function public.youth_announcement_publish(p_id uuid, p_publish_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  a youth.announcements;
begin
  select * into a from youth.announcements where id = p_id for update;
  if a.id is null or not youth.can_publish(a.group_id, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if a.status <> 'draft' then
    raise exception 'Only drafts can be published.' using errcode = '22023';
  end if;
  update youth.announcements set status = 'published', publish_at = greatest(coalesce(p_publish_at, now()), now()), published_by = v_uid
   where id = a.id
  returning * into a;
  if a.publish_at <= now() then
    perform youth.announce(a);
  end if;
  perform youth.audit('youth.announcement_published', 'youth_announcement', a.id);
end;
$$;

create function public.youth_announcement_archive(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_group uuid;
begin
  select group_id into v_group from youth.announcements where id = p_id;
  if not found or not youth.can_publish(v_group, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  update youth.announcements set status = 'archived' where id = p_id;
  delete from community.notifications where youth_announcement_id = p_id and read_at is null;
  perform youth.audit('youth.announcement_archived', 'youth_announcement', p_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Supervised discussions
-- ---------------------------------------------------------------------------
create function youth.supervised(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from youth.group_leaders l where l.group_id = p_group and l.status = 'active' and youth.is_leader(p_group, l.profile_id))
           >= coalesce((youth.setting('discussion_min_leaders') #>> '{}')::integer, 2)
     and (select count(*) from youth.enrollments e join youth.children c on c.id = e.child_id
           where e.group_id = p_group and e.status = 'active' and c.status = 'active') >= 3;
$$;

-- reader: leaders of the group; enrolled active youth (policy); guardians of
-- enrolled children allowed to receive updates (policy: read).
create function youth.discussion_role(d youth.discussions, p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when d.id is null then null
    when youth.is_leader(d.group_id, p_profile) then 'leader'
    when d.hidden_at is not null or d.status = 'archived' then null
    when not youth.flag('youth_discussions') then null
    when d.kind = 'prayer' and not youth.flag('group_prayer') then null
    when youth.youth_in_group(d.group_id, p_profile) then 'youth'
    when youth.setting('guardian_discussion_access') #>> '{}' = 'read'
         and youth.guardian_in_group(d.group_id, p_profile, 'receive_updates') then 'guardian'
    else null end;
$$;

create function youth.author_label(p_author uuid, p_group uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_author is null then 'Former participant'
    when youth.account_child(p_author) is not null then (select c.display_name from youth.children c where c.id = youth.account_child(p_author))
    when exists (select 1 from youth.group_leaders l where l.group_id = p_group and l.profile_id = p_author) then community.display_name(p_author) || ' (leader)'
    else community.display_name(p_author) end;
$$;

-- Who can see a discussion, in plain words for the page.
create function youth.audience_json(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'leaders', coalesce((select jsonb_agg(community.display_name(l.profile_id) order by community.display_name(l.profile_id))
                          from youth.group_leaders l where l.group_id = p_group and l.status = 'active' and youth.is_leader(p_group, l.profile_id)), '[]'::jsonb),
    'youth', (select count(*) from youth.enrollments e join youth.children c on c.id = e.child_id
               where e.group_id = p_group and e.status = 'active' and c.account_id is not null and youth.is_active_youth(c.account_id)),
    'guardians_can_read', youth.setting('guardian_discussion_access') #>> '{}' = 'read',
    'safeguarding_reviews_reports', true);
$$;

create function public.youth_discussion_create(p_group uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_kind text := coalesce(p ->> 'kind', 'discussion');
  d youth.discussions;
begin
  perform community.rate_limit(v_uid, 'youth_discussion', 20, interval '1 hour');
  if not youth.is_leader(p_group, v_uid) then
    raise exception 'Only leaders of this group can start a discussion.' using errcode = '42501';
  end if;
  if not youth.flag('youth_discussions') then
    raise exception 'Supervised discussions aren''t enabled under the church''s current policy.' using errcode = '22023';
  end if;
  if v_kind not in ('discussion', 'prayer') or (v_kind = 'prayer' and not youth.flag('group_prayer')) then
    raise exception 'Group prayer isn''t enabled under the church''s current policy.' using errcode = '22023';
  end if;
  if not youth.supervised(p_group) then
    raise exception 'This group needs more leaders or members before discussions can open.' using errcode = '22023';
  end if;
  if btrim(coalesce(p ->> 'title', '')) = '' or char_length(p ->> 'title') > 160
     or btrim(coalesce(p ->> 'body', '')) = '' or char_length(p ->> 'body') > 4000 then
    raise exception 'Enter a title and an opening message.' using errcode = '22023';
  end if;
  insert into youth.discussions (group_id, kind, title, created_by, last_post_at) values (p_group, v_kind, btrim(p ->> 'title'), v_uid, now())
  returning * into d;
  insert into youth.posts (discussion_id, author_id, body, client_key) values (d.id, v_uid, btrim(p ->> 'body'), gen_random_uuid());
  insert into youth.moderation_log (actor_id, action, discussion_id) values (v_uid, 'discussion_started', d.id);
  return jsonb_build_object('id', d.id);
end;
$$;

create function public.youth_discussions(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
            'id', d.id, 'title', d.title, 'kind', d.kind, 'status', d.status, 'hidden', d.hidden_at is not null,
            'last_post_at', d.last_post_at,
            'posts', (select count(*) from youth.posts p where p.discussion_id = d.id and p.status = 'visible'))
          order by d.last_post_at desc nulls last)
     from youth.discussions d where d.group_id = p_group and youth.discussion_role(d, v_uid) is not null), '[]'::jsonb);
end;
$$;

create function public.youth_discussion(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d youth.discussions;
  v_role text;
begin
  select * into d from youth.discussions where id = p_id;
  v_role := youth.discussion_role(d, v_uid);
  if v_role is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', d.id, 'group_id', d.group_id, 'group', (select name from youth.groups where id = d.group_id),
    'title', d.title, 'kind', d.kind, 'status', d.status, 'hidden', d.hidden_at is not null, 'role', v_role,
    'can_post', v_role in ('leader', 'youth') and d.status = 'open' and d.hidden_at is null and youth.flag('youth_discussions')
                and youth.supervised(d.group_id),
    'supervised', youth.supervised(d.group_id),
    'audience', youth.audience_json(d.group_id),
    'posts', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', p.id, 'author', youth.author_label(p.author_id, d.group_id), 'mine', p.author_id = v_uid,
                 'status', p.status, 'created_at', p.created_at,
                 'body', case when p.status = 'visible' or (p.status = 'hidden' and v_role = 'leader') then p.body else '' end)
               order by p.created_at, p.id)
             from youth.posts p where p.discussion_id = d.id and (p.status = 'visible' or v_role = 'leader' or p.status = 'deleted')), '[]'::jsonb));
end;
$$;

create function public.youth_post(p_discussion uuid, p_body text, p_client_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d youth.discussions;
  v_role text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  select * into d from youth.discussions where id = p_discussion for update;
  v_role := youth.discussion_role(d, v_uid);
  if v_role not in ('leader', 'youth') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select id into v_id from youth.posts where author_id = v_uid and client_key = p_client_key;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'replayed', true);
  end if;
  perform community.rate_limit(v_uid, 'youth_post', 30, interval '10 minutes');
  if d.status <> 'open' or d.hidden_at is not null or not youth.flag('youth_discussions') then
    raise exception 'This discussion is closed.' using errcode = '22023';
  end if;
  if not youth.supervised(d.group_id) then
    raise exception 'This group needs more leaders or members before posting can continue.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_body, '')) = '' or char_length(p_body) > 4000 then
    raise exception 'Write a message (4000 characters or fewer).' using errcode = '22023';
  end if;
  insert into youth.posts (discussion_id, author_id, body, client_key) values (d.id, v_uid, btrim(p_body), p_client_key)
  returning id into v_id;
  update youth.discussions set last_post_at = now() where id = d.id;
  return jsonb_build_object('id', v_id);
end;
$$;

create function public.youth_post_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  update youth.posts set status = 'deleted', body = '' where id = p_id and author_id = v_uid and status <> 'deleted';
  if not found then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
end;
$$;

-- Leaders: hide/restore posts, lock/unlock/archive discussions in their groups.
create function public.youth_moderate(p_target text, p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  d youth.discussions;
  v_post uuid;
begin
  if p_target = 'post' then
    select dd.* into d from youth.posts p join youth.discussions dd on dd.id = p.discussion_id where p.id = p_id;
    v_post := p_id;
  else
    select * into d from youth.discussions where id = p_id;
  end if;
  if d.id is null or not (youth.is_leader(d.group_id, v_uid) or public.has_capability('youth.safeguarding')) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  case p_action
    when 'hide' then
      if v_post is null then
        update youth.discussions set hidden_at = now() where id = d.id;
      else
        update youth.posts set status = 'hidden', hidden_by = v_uid, hidden_at = now() where id = v_post and status = 'visible';
      end if;
    when 'restore' then
      if v_post is null then
        update youth.discussions set hidden_at = null where id = d.id;
      else
        update youth.posts set status = 'visible', hidden_by = null, hidden_at = null where id = v_post and status = 'hidden';
      end if;
    when 'lock' then update youth.discussions set status = 'locked' where id = d.id and status = 'open';
    when 'unlock' then update youth.discussions set status = 'open' where id = d.id and status = 'locked';
    when 'archive' then update youth.discussions set status = 'archived' where id = d.id;
    else raise exception 'Unknown action.' using errcode = '22023';
  end case;
  insert into youth.moderation_log (actor_id, action, discussion_id, post_id) values (v_uid, p_action, d.id, v_post);
end;
$$;

create function youth.can_review(r youth.reports, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select r.id is not null and youth.is_adult(p_profile)
     and p_profile is distinct from r.reporter_id and p_profile is distinct from r.subject_id
     and case when r.about_leader
              then youth.holds(p_profile, 'youth.safeguarding')
                   and not exists (select 1 from youth.discussions d join youth.group_leaders l on l.group_id = d.group_id
                                    where d.id = r.discussion_id and l.profile_id = p_profile and l.status = 'active')
              else youth.holds(p_profile, 'youth.safeguarding')
                   or exists (select 1 from youth.discussions d where d.id = r.discussion_id and youth.is_leader(d.group_id, p_profile)) end;
$$;

-- {reason, note}. Anyone who can read the discussion.
create function public.youth_report(p_discussion uuid, p_post uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d youth.discussions;
  po youth.posts;
  v_subject uuid;
  r youth.reports;
begin
  select * into d from youth.discussions where id = p_discussion;
  if youth.discussion_role(d, v_uid) is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform community.rate_limit(v_uid, 'youth_report', 10, interval '1 hour');
  if coalesce(p ->> 'reason', '') not in ('unsafe', 'bullying', 'inappropriate', 'private_contact', 'other') or char_length(coalesce(p ->> 'note', '')) > 500 then
    raise exception 'Choose a reason.' using errcode = '22023';
  end if;
  if p_post is not null then
    select * into po from youth.posts where id = p_post and discussion_id = d.id;
    if po.id is null then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
    v_subject := po.author_id;
  else
    v_subject := d.created_by;
  end if;
  insert into youth.reports (discussion_id, post_id, reporter_id, subject_id, about_leader, reason, note, evidence)
  values (d.id, p_post, v_uid, v_subject,
          exists (select 1 from youth.group_leaders l where l.group_id = d.group_id and l.profile_id = v_subject),
          p ->> 'reason', coalesce(p ->> 'note', ''),
          jsonb_build_object('discussion_title', d.title, 'group', (select name from youth.groups where id = d.group_id),
                             'body', case when po.id is not null then po.body end, 'posted_at', po.created_at,
                             'author', youth.author_label(v_subject, d.group_id)))
  returning * into r;
  perform youth.notify(x.id, 'youth_report', jsonb_build_object('youth_report_id', r.id), 'youth_report:' || r.id)
     from public.profiles x
    where youth.can_review(r, x.id)
      and (youth.holds(x.id, 'youth.safeguarding') or youth.is_leader(d.group_id, x.id));
end;
$$;

create function public.youth_reports(p_status text default 'open')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'discussion_id', r.discussion_id, 'post_id', r.post_id, 'reason', r.reason, 'note', r.note,
            'about_leader', r.about_leader, 'status', r.status, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
            'evidence', r.evidence,
            'post_status', (select p.status from youth.posts p where p.id = r.post_id))
          order by r.created_at), '[]'::jsonb)
    into v_out
    from youth.reports r
   where (r.status = p_status or (p_status = 'all' and r.created_at > now() - interval '180 days')) and youth.can_review(r, v_uid);
  if jsonb_array_length(v_out) > 0 then
    insert into youth.access_log (actor_id, kind, item_count) values (v_uid, 'report_evidence_view', jsonb_array_length(v_out));
  end if;
  return v_out;
end;
$$;

-- {outcome: actioned|dismissed, hide: bool}
create function public.youth_report_resolve(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  r youth.reports;
begin
  select * into r from youth.reports where id = p_id for update;
  if not youth.can_review(r, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'open' then
    raise exception 'This report was already resolved.' using errcode = '22023';
  end if;
  if coalesce(p ->> 'outcome', '') not in ('actioned', 'dismissed') then
    raise exception 'Choose an outcome.' using errcode = '22023';
  end if;
  if coalesce((p ->> 'hide')::boolean, false) then
    if r.post_id is not null then
      update youth.posts set status = 'hidden', hidden_by = v_uid, hidden_at = now() where id = r.post_id and status = 'visible';
    else
      update youth.discussions set hidden_at = now() where id = r.discussion_id;
    end if;
  end if;
  update youth.reports set status = p ->> 'outcome', resolved_by = v_uid, resolved_at = now() where id = r.id;
  insert into youth.moderation_log (actor_id, action, discussion_id, post_id, report_id)
  values (v_uid, 'report_' || (p ->> 'outcome'), r.discussion_id, r.post_id, r.id);
  delete from community.notifications where youth_report_id = r.id and read_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Learning assignments
-- ---------------------------------------------------------------------------
create function youth.learning_json(l youth.learning, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'group_id', l.group_id, 'kind', l.kind, 'note', l.note, 'starts_on', l.starts_on, 'ends_on', l.ends_on,
    'status', l.status,
    'title', case l.kind
               when 'memory_collection' then (select c.title from memory.collections c where c.id = l.memory_collection_id)
               when 'reading_plan' then (select p.title from bible.plans p where p.id = l.bible_plan_id)
               else (select i.title from media.items i where i.id = l.media_item_id) end,
    'ref_id', coalesce(l.memory_collection_id, l.bible_plan_id, l.media_item_id),
    -- A link only when the viewer can open it.
    'href', case l.kind
              when 'memory_collection' then case when memory.collection_visible_id(l.memory_collection_id, p_viewer)
                                                 then '/memory/collections/' || l.memory_collection_id end
              when 'reading_plan' then case when bible.plan_visible_id(l.bible_plan_id, p_viewer) then '/bible/plans/' || l.bible_plan_id end
              else (select case when media.item_visible(i, p_viewer)
                                then case i.kind::text when 'devotional' then '/devotionals/' when 'lesson' then '/lessons/'
                                                       when 'assignment' then '/reading/assignments/' else '/media/items/' end || i.id end
                      from media.items i where i.id = l.media_item_id) end);
$$;

create function youth.learning_current(l youth.learning)
returns boolean
language sql
stable
set search_path = ''
as $$
  select l.status = 'active' and (l.starts_on is null or l.starts_on <= current_date + 7) and (l.ends_on is null or l.ends_on >= current_date);
$$;

-- What a publisher can assign: church-wide published collections, plans, teaching.
create function public.youth_learning_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  if not (public.has_capability('youth.publish') or exists (select 1 from youth.group_leaders l where l.profile_id = v_uid and l.status = 'active'
                                                              and l.can_publish and youth.is_leader(l.group_id, v_uid))) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'memory_collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) order by c.title)
                                     from memory.collections c where c.audience = 'members' and c.status = 'published'), '[]'::jsonb),
    'reading_plans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title) order by p.title)
                                from bible.plans p where p.audience = 'members' and p.status = 'published'), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'kind', i.kind) order by i.title)
                            from media.items i where i.kind::text in ('devotional', 'lesson', 'assignment')
                             and i.audience::text in ('public', 'members') and media.is_live(i.status, i.publish_at, i.expires_at)), '[]'::jsonb));
end;
$$;

-- {kind, ref_id, note, starts_on, ends_on}
create function public.youth_learning_assign(p_group uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_ref uuid := nullif(p ->> 'ref_id', '')::uuid;
  v_kind text := p ->> 'kind';
  l youth.learning;
begin
  if not youth.can_publish(p_group, v_uid) or not exists (select 1 from youth.groups where id = p_group and status = 'active') then
    raise exception 'You can''t publish to that group.' using errcode = '42501';
  end if;
  if v_kind = 'memory_collection' and not exists (select 1 from memory.collections c where c.id = v_ref and c.audience = 'members' and c.status = 'published')
     or v_kind = 'reading_plan' and not exists (select 1 from bible.plans pl where pl.id = v_ref and pl.audience = 'members' and pl.status = 'published')
     or v_kind = 'resource' and not exists (select 1 from media.items i where i.id = v_ref and i.audience::text in ('public', 'members')
                                              and media.is_live(i.status, i.publish_at, i.expires_at))
     or v_kind not in ('memory_collection', 'reading_plan', 'resource') then
    raise exception 'Choose something published for the whole church.' using errcode = '22023';
  end if;
  insert into youth.learning (group_id, kind, memory_collection_id, bible_plan_id, media_item_id, note, starts_on, ends_on, assigned_by)
  values (p_group, v_kind, case when v_kind = 'memory_collection' then v_ref end, case when v_kind = 'reading_plan' then v_ref end,
          case when v_kind = 'resource' then v_ref end, left(coalesce(p ->> 'note', ''), 300),
          nullif(p ->> 'starts_on', '')::date, nullif(p ->> 'ends_on', '')::date, v_uid)
  returning * into l;
  perform youth.notify(x.guardian_id, 'youth_learning', jsonb_build_object('youth_learning_id', l.id), 'youth_learning:' || l.id)
     from (select distinct g.guardian_id from youth.enrollments e join youth.guardianships g on g.child_id = e.child_id
            where e.group_id = p_group and e.status = 'active' and g.status = 'verified' and (g.can_practice or g.can_receive_updates)
              and youth.guardian_can(e.child_id, g.guardian_id)) x;
  perform youth.audit('youth.learning_assigned', 'youth_group', p_group, jsonb_build_object('kind', v_kind));
  return jsonb_build_object('id', l.id);
end;
$$;

create function public.youth_learning_archive(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  v_group uuid;
begin
  select group_id into v_group from youth.learning where id = p_id;
  if v_group is null or not youth.can_publish(v_group, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  update youth.learning set status = 'archived' where id = p_id;
  delete from community.notifications where youth_learning_id = p_id and read_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Youth home, group pages, leader hub
-- ---------------------------------------------------------------------------
create function youth.group_brief(g youth.groups, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description,
    'leaders', coalesce((select jsonb_agg(community.display_name(l.profile_id) order by community.display_name(l.profile_id))
                          from youth.group_leaders l where l.group_id = g.id and l.status = 'active' and youth.is_leader(g.id, l.profile_id)), '[]'::jsonb),
    'learning', coalesce((select jsonb_agg(youth.learning_json(l, p_viewer) order by l.created_at desc)
                           from youth.learning l where l.group_id = g.id and youth.learning_current(l)), '[]'::jsonb));
$$;

-- An independent youth's home.
create function public.youth_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_youth();
  v_child uuid := youth.account_child(v_uid);
begin
  return jsonb_build_object(
    'display_name', (select display_name from youth.children where id = v_child),
    'groups', coalesce((select jsonb_agg(youth.group_brief(g, v_uid) order by g.name)
                         from youth.enrollments e join youth.groups g on g.id = e.group_id
                        where e.child_id = v_child and e.status = 'active' and g.status = 'active'), '[]'::jsonb),
    'announcements', public.youth_announcements(null),
    'events', coalesce((select jsonb_agg(youth.occurrence_for_child(o, s, es, v_child, v_uid) - 'forms' - 'collects' - 'logistics_on_file'
                                         || jsonb_build_object('needs_guardian', exists (select 1 from youth.event_forms ef where ef.series_id = s.id)
                                                                 or es.collect_emergency_contact or es.collect_pickup or es.collect_accommodation)
                                         order by o.starts_at)
                         from youth.event_settings es join events.series s on s.id = es.series_id join events.occurrences o on o.series_id = s.id
                        where events.is_live(s.status, s.publish_at) and o.ends_at > now() and o.starts_at < now() + interval '120 days'
                          and youth.enrolled(es.group_id, v_child)), '[]'::jsonb),
    'discussions_enabled', youth.flag('youth_discussions'));
end;
$$;

-- One group, for its leaders, enrolled youth, and guardians of enrolled children.
create function public.youth_group(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  g youth.groups;
  v_role text;
begin
  select * into g from youth.groups where id = p_id and status = 'active';
  v_role := case when g.id is null then null
                 when youth.is_leader(g.id, v_uid) then 'leader'
                 when youth.youth_in_group(g.id, v_uid) then 'youth'
                 when youth.guardian_in_group(g.id, v_uid) then 'guardian' end;
  if v_role is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return youth.group_brief(g, v_uid) || jsonb_build_object(
    'role', v_role,
    'can_publish', youth.can_publish(g.id, v_uid),
    'announcements', public.youth_announcements(g.id),
    'discussions', public.youth_discussions(g.id),
    'discussions_enabled', youth.flag('youth_discussions'),
    'supervised', youth.supervised(g.id),
    'audience', youth.audience_json(g.id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('occurrence_id', o.id, 'series_id', s.id, 'title', s.title, 'starts_at', o.starts_at,
                                                          'status', o.status) order by o.starts_at)
                         from youth.event_settings es join events.series s on s.id = es.series_id join events.occurrences o on o.series_id = s.id
                        where es.group_id = g.id and events.is_live(s.status, s.publish_at) and o.ends_at > now()
                          and o.starts_at < now() + interval '120 days'), '[]'::jsonb));
end;
$$;

create function public.youth_lead_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  return jsonb_build_object(
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'role', l.role, 'can_publish', l.can_publish,
                                                          'can_manage_enrollment', l.can_manage_enrollment,
                                                          'enrolled', (select count(*) from youth.enrollments e where e.group_id = g.id and e.status = 'active'),
                                                          'supervised', youth.supervised(g.id)) order by g.name)
                         from youth.group_leaders l join youth.groups g on g.id = l.group_id
                        where l.profile_id = v_uid and l.status = 'active' and youth.is_leader(g.id, v_uid)), '[]'::jsonb),
    'open_reports', (select count(*) from youth.reports r where r.status = 'open' and youth.can_review(r, v_uid)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('series_id', s.id, 'title', s.title, 'group', g.name,
                                                          'next', (select min(o.starts_at) from events.occurrences o where o.series_id = s.id and o.ends_at > now()),
                                                          'personnel', exists (select 1 from youth.event_personnel ep where ep.series_id = s.id and ep.profile_id = v_uid))
                                         order by s.start_date)
                         from youth.event_settings es join events.series s on s.id = es.series_id join youth.groups g on g.id = es.group_id
                        where s.status in ('draft', 'published') and (youth.is_leader(es.group_id, v_uid)
                              or exists (select 1 from youth.event_personnel ep where ep.series_id = s.id and ep.profile_id = v_uid))
                          and exists (select 1 from events.occurrences o where o.series_id = s.id and o.ends_at > now())), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardian-led practice for a child profile (reuses the Phase 9 engine)
-- ---------------------------------------------------------------------------
create function youth.as_session(y youth.practice_sessions)
returns memory.sessions
language plpgsql
immutable
set search_path = ''
as $$
declare
  x memory.sessions;
begin
  x.id := y.id; x.profile_id := y.operator_id; x.card_id := y.card_id; x.passage_id := y.passage_id;
  x.activity := y.activity; x.difficulty := y.difficulty; x.segment := y.segment; x.short_segments := y.short_segments;
  x.token_from := y.token_from; x.token_to := y.token_to; x.setup := y.setup; x.hints := y.hints; x.revealed := y.revealed;
  x.status := y.status; x.result := y.result; x.created_at := y.created_at; x.expires_at := y.expires_at; x.submitted_at := y.submitted_at;
  return x;
end;
$$;

-- Memory items assigned to the child's groups now.
create function youth.child_items(p_child uuid)
returns setof memory.items
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.*
    from youth.learning l
    join memory.collections c on c.id = l.memory_collection_id and c.status = 'published' and c.publish_at <= now()
    join memory.items i on i.collection_id = c.id and i.retired_at is null
   where l.kind = 'memory_collection' and youth.learning_current(l) and youth.enrolled(l.group_id, p_child)
     and bible.translation_active(c.translation_id);
$$;

create function youth.child_card_json(k youth.practice_cards)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', k.id, 'item_id', k.item_id, 'reference', p.label, 'step', k.step, 'stage', memory.stage(k.step),
                            'due_on', k.due_on, 'review_ready', k.best_step >= 3, 'sessions', k.sessions,
                            'last_practiced_at', k.last_practiced_at, 'segments', jsonb_array_length(p.short_segments),
                            'word_count', p.word_count,
                            'translation', (select t.code from bible.translations t where t.id = p.translation_id))
    from memory.passages p where p.id = k.passage_id;
$$;

create function public.youth_child_practice(p_child uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  if not youth.guardian_can(p_child, v_uid, 'practice') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from youth.children c where c.id = p_child and c.account_id is not null) then
    return jsonb_build_object('independent', true);
  end if;
  return jsonb_build_object(
    'independent', false,
    'child', (select jsonb_build_object('id', c.id, 'display_name', c.display_name) from youth.children c where c.id = p_child),
    'assigned', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'title', i.title, 'reference', p.label,
                                                            'collection', (select c.title from memory.collections c where c.id = i.collection_id),
                                                            'card_id', (select k.id from youth.practice_cards k where k.child_id = p_child
                                                                         and k.passage_id = i.passage_id and k.status = 'active'))
                                          order by i.starts_on nulls last, i.position)
                           from youth.child_items(p_child) i join memory.passages p on p.id = i.passage_id), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(youth.child_card_json(k) order by k.due_on nulls first, k.added_at)
                        from youth.practice_cards k where k.child_id = p_child and k.status = 'active'), '[]'::jsonb));
end;
$$;

create function public.youth_child_card_add(p_child uuid, p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  i memory.items;
  k youth.practice_cards;
begin
  if not youth.guardian_can(p_child, v_uid, 'practice')
     or exists (select 1 from youth.children c where c.id = p_child and c.account_id is not null) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into i from youth.child_items(p_child) x where x.id = p_item;
  if i.id is null then
    raise exception 'That verse isn''t assigned to this child''s groups.' using errcode = 'P0002';
  end if;
  insert into youth.practice_cards (child_id, passage_id, item_id, due_on, added_by)
  values (p_child, i.passage_id, i.id, memory.local_today(memory.member_tz(v_uid)), v_uid)
  on conflict (child_id, passage_id) do update set status = 'active', updated_at = now()
  returning * into k;
  return youth.child_card_json(k);
end;
$$;

create function youth.load_child_session(p_id uuid, p_uid uuid)
returns youth.practice_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  x youth.practice_sessions;
begin
  select * into x from youth.practice_sessions where id = p_id for update;
  if x.id is null or not youth.guardian_can(x.child_id, p_uid, 'practice') then
    raise exception 'That practice activity wasn''t found.' using errcode = 'P0002';
  end if;
  if x.status = 'open' and x.expires_at <= now() then
    update youth.practice_sessions set status = 'expired' where id = x.id returning * into x;
  end if;
  return x;
end;
$$;

-- Activities as in Phase 9 (kids presentation: shorter parts by default).
create function public.youth_child_session_start(p_child uuid, p_card uuid, p_activity text, p_difficulty text, p_segment integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  k youth.practice_cards;
  pa memory.passages;
  s memory.member_settings := memory.settings_of(v_uid);
  v_activity memory.activity;
  v_difficulty memory.difficulty;
  v_from integer;
  v_to integer;
  v_id uuid := gen_random_uuid();
  y youth.practice_sessions;
begin
  perform community.rate_limit(v_uid, 'youth_practice', 200, interval '10 minutes');
  if not youth.guardian_can(p_child, v_uid, 'practice') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_activity not in ('read_repeat', 'flashcards', 'missing_words', 'word_order', 'type_verse', 'self_check')
     or coalesce(p_difficulty, 'guided') not in ('guided', 'growing', 'challenge') then
    raise exception 'Choose an activity and difficulty.' using errcode = '22023';
  end if;
  v_activity := p_activity::memory.activity;
  v_difficulty := coalesce(p_difficulty, 'guided')::memory.difficulty;
  select * into k from youth.practice_cards where id = p_card and child_id = p_child and status = 'active';
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  select * into pa from memory.passages where id = k.passage_id;
  if not bible.translation_active(pa.translation_id) then
    raise exception 'This verse''s Bible version is no longer available for practice.' using errcode = '22023';
  end if;
  if coalesce(p_segment, 0) = 0 then
    if v_activity in ('missing_words', 'word_order', 'type_verse') and pa.word_count > 80 then
      raise exception 'This passage is long. Practice it one part at a time.' using errcode = '22023';
    end if;
    v_from := 0;
    v_to := jsonb_array_length(pa.tokens) - 1;
  else
    select (e ->> 'from')::integer, (e ->> 'to')::integer into v_from, v_to
      from jsonb_array_elements(pa.short_segments) e where (e ->> 'n')::integer = p_segment;
    if v_from is null then
      raise exception 'That part of the passage doesn''t exist.' using errcode = '22023';
    end if;
  end if;
  if v_activity = 'word_order' and (select count(*) from memory.words(pa.tokens, v_from, v_to, true, true)) < 2 then
    raise exception 'This passage is too short for word order.' using errcode = '22023';
  end if;
  insert into youth.practice_sessions (id, child_id, operator_id, card_id, passage_id, activity, difficulty, segment, short_segments,
                                       token_from, token_to, setup)
  values (v_id, p_child, v_uid, k.id, pa.id, v_activity, v_difficulty, coalesce(p_segment, 0), true, v_from, v_to,
          memory.build_setup(v_id, pa, v_activity, v_difficulty, v_from, v_to, k.step, s, '{}'::jsonb))
  returning * into y;
  return memory.session_json(youth.as_session(y))
    || jsonb_build_object('child', (select jsonb_build_object('id', c.id, 'display_name', c.display_name) from youth.children c where c.id = p_child));
end;
$$;

create function public.youth_child_session_hint(p_session uuid, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  y youth.practice_sessions;
  pa memory.passages;
  v_words text[];
  v_pos integer;
  v_idx integer;
  v_hint jsonb;
begin
  perform community.rate_limit(v_uid, 'youth_practice_hint', 300, interval '10 minutes');
  y := youth.load_child_session(p_session, v_uid);
  if y.status <> 'open' then
    return jsonb_build_object('status', y.status);
  end if;
  select * into pa from memory.passages where id = y.passage_id;
  select array_agg(w.t order by w.idx) into v_words from memory.words(pa.tokens, y.token_from, y.token_to, true, true) w;
  case y.activity
    when 'type_verse' then
      v_pos := least(greatest(coalesce((p ->> 'position')::integer, 0), 0), cardinality(v_words) - 1);
      v_hint := jsonb_build_object('position', v_pos, 'word', v_words[v_pos + 1]);
    when 'missing_words' then
      v_pos := (p ->> 'blank')::integer;
      v_idx := (y.setup -> 'blanks' ->> (v_pos - 1))::integer;
      if v_idx is null then
        raise exception 'Choose a blank.' using errcode = '22023';
      end if;
      v_hint := jsonb_build_object('blank', v_pos, 'word', memory.token_core(pa.tokens -> v_idx ->> 't') ->> 'core');
      update youth.practice_sessions set setup = jsonb_set(setup, '{hinted}', (setup -> 'hinted') || to_jsonb(v_pos)) where id = y.id;
    when 'self_check' then
      v_hint := jsonb_build_object('words', array_to_string(v_words[1:least(3 * (y.hints + 1), cardinality(v_words))], ' '),
                                   'more', 3 * (y.hints + 1) < cardinality(v_words));
    else
      raise exception 'This activity has no hints here.' using errcode = '22023';
  end case;
  update youth.practice_sessions set hints = hints + 1 where id = y.id;
  return v_hint || jsonb_build_object('hints', y.hints + 1);
end;
$$;

create function public.youth_child_session_reveal(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  y youth.practice_sessions;
  pa memory.passages;
begin
  y := youth.load_child_session(p_session, v_uid);
  if y.activity not in ('self_check', 'flashcards') then
    raise exception 'This activity has nothing to reveal.' using errcode = '22023';
  end if;
  if y.status = 'expired' then
    return jsonb_build_object('status', y.status);
  end if;
  select * into pa from memory.passages where id = y.passage_id;
  update youth.practice_sessions set revealed = true where id = y.id;
  return jsonb_build_object('status', y.status, 'reference', pa.label,
    'text', case when y.activity = 'flashcards' and y.setup ->> 'direction' = 'text_to_ref' then null
                 else memory.range_text(pa.tokens, y.token_from, y.token_to) end);
end;
$$;

-- Scored exactly as Phase 9, recorded on the child (no badges, no
-- leaderboards). Retries return the stored result.
create function public.youth_child_session_submit(p_session uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  y youth.practice_sessions;
  k youth.practice_cards;
  pa memory.passages;
  v_today date := memory.local_today(memory.member_tz(v_uid));
  v_details jsonb := '{}'::jsonb;
  v_accuracy numeric;
  v_hints integer;
  v_conf text := nullif(p ->> 'confidence', '');
  v_quality memory.quality;
  v_recall boolean;
  v_step integer;
  v_due date;
  v_change text := 'practice';
  v_was_due boolean;
  v_step_before integer;
  v_verses integer[];
  v_result jsonb;
begin
  perform community.rate_limit(v_uid, 'youth_practice_submit', 120, interval '10 minutes');
  y := youth.load_child_session(p_session, v_uid);
  if y.status = 'submitted' then
    return y.result || jsonb_build_object('replayed', true);
  end if;
  if y.status = 'expired' then
    return jsonb_build_object('status', 'expired', 'saved', false);
  end if;
  select * into k from youth.practice_cards where id = y.card_id for update;
  if k.id is null or k.status <> 'active' or k.passage_id <> y.passage_id then
    return jsonb_build_object('status', 'conflict', 'saved', false);
  end if;
  select * into pa from memory.passages where id = y.passage_id;
  if v_conf is not null and v_conf not in ('not_yet', 'partly', 'mostly', 'fully') then
    raise exception 'Choose how well they knew it.' using errcode = '22023';
  end if;
  v_hints := y.hints;
  case y.activity
    when 'read_repeat' then
      v_hints := v_hints + least(greatest(coalesce((p ->> 'reveals')::integer, 0), 0), 500);
      v_details := jsonb_build_object('level', least(greatest(coalesce((p ->> 'level')::integer, 0), 0), 3));
    when 'flashcards', 'self_check' then
      if not y.revealed then
        raise exception 'Reveal the verse before checking.' using errcode = '22023';
      end if;
      if v_conf is null then
        raise exception 'Choose how well they knew it.' using errcode = '22023';
      end if;
    when 'missing_words' then
      v_details := memory.score_blanks(pa.tokens, (select array_agg(b::integer) from jsonb_array_elements_text(y.setup -> 'blanks') b),
                                       coalesce(p -> 'answers', '{}'::jsonb), coalesce((y.setup ->> 'ignore_case')::boolean, true));
      v_accuracy := (v_details ->> 'accuracy')::numeric;
    when 'word_order' then
      v_details := memory.score_order(pa.tokens, y.setup -> 'chips', p -> 'order');
      v_accuracy := (v_details ->> 'accuracy')::numeric;
    when 'type_verse' then
      select array_agg(distinct (e ->> 'v')::integer) into v_verses
        from jsonb_array_elements(pa.tokens) with ordinality q(e, n) where n - 1 between y.token_from and y.token_to;
      v_details := memory.score_typed(pa.tokens, y.token_from, y.token_to, p ->> 'text',
                                      (y.setup ->> 'ignore_case')::boolean, (y.setup ->> 'ignore_punct')::boolean,
                                      (select b.name from bible.books b where b.code = pa.book_code), v_verses)
                   || jsonb_build_object('your_text', left(coalesce(p ->> 'text', ''), 20000),
                                         'text', memory.range_text(pa.tokens, y.token_from, y.token_to));
      v_accuracy := (v_details ->> 'accuracy')::numeric;
  end case;
  v_quality := memory.quality_of(y.activity, v_accuracy, v_hints, v_conf);
  v_recall := memory.is_recall(y.activity, y.difficulty);
  v_step_before := k.step;
  v_step := k.step;
  v_due := k.due_on;
  v_was_due := k.due_on is null or k.due_on <= v_today;
  if k.last_scheduled_on is not distinct from v_today then
    v_change := 'already_today';
  elsif v_quality = 'none' then
    v_change := 'practice';
  elsif not v_recall then
    if v_quality = 'strong' and k.step = 0 then
      v_step := 1; v_due := v_today + 1; v_change := 'advanced';
    end if;
  elsif v_quality = 'strong' then
    if v_was_due then
      v_step := least(k.step + 1, 7); v_due := v_today + memory.interval_for(v_step); v_change := 'advanced';
    else
      v_change := 'early';
    end if;
  elsif v_quality = 'partial' then
    if v_was_due then
      v_due := v_today + greatest(1, memory.interval_for(k.step) / 2); v_change := 'kept';
    else
      v_change := 'early';
    end if;
  else
    v_step := greatest(k.step - 1, 0); v_due := v_today + 1; v_change := 'eased';
  end if;
  update youth.practice_cards set
    step = v_step, due_on = v_due, best_step = greatest(best_step, v_step),
    last_scheduled_on = case when v_change in ('advanced', 'kept', 'eased') then v_today else last_scheduled_on end,
    sessions = sessions + 1, last_practiced_at = now(), updated_at = now()
  where id = k.id
  returning * into k;
  insert into youth.practice_attempts (session_id, card_id, child_id, operator_id, passage_id, activity, difficulty, segment, accuracy, hints,
                                       confidence, quality, step_before, step_after, local_date)
  values (y.id, k.id, y.child_id, v_uid, pa.id, y.activity, y.difficulty, y.segment, v_accuracy, v_hints, v_conf, v_quality,
          v_step_before, v_step, v_today);
  v_result := jsonb_build_object(
    'status', 'saved', 'saved', true, 'session_id', y.id, 'card_id', k.id, 'activity', y.activity, 'difficulty', y.difficulty,
    'completed', true, 'accuracy', v_accuracy, 'hints', v_hints, 'confidence', v_conf, 'quality', v_quality, 'recall', v_recall,
    'details', v_details, 'recorded_for', (select display_name from youth.children where id = y.child_id),
    'review', jsonb_build_object('change', v_change, 'step', k.step, 'stage', memory.stage(k.step), 'due_on', k.due_on,
                                 'review_ready', k.best_step >= 3),
    'badges', '[]'::jsonb);
  update youth.practice_sessions set status = 'submitted', submitted_at = now(), result = v_result where id = y.id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Progress summaries for guardians (never answers or reflections)
-- ---------------------------------------------------------------------------
create function public.youth_child_progress(p_child uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  c youth.children;
begin
  if not youth.guardian_can(p_child, v_uid, 'view_progress') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into c from youth.children where id = p_child;
  if c.account_id is not null then
    -- Independent youth: only what they chose to share, when the policy offers it.
    if youth.setting('progress_sharing') #>> '{}' <> 'youth_choice'
       or not coalesce((select s.share_summary from youth.progress_sharing s where s.child_id = c.id), false) then
      return jsonb_build_object('independent', true, 'shared', false);
    end if;
    return jsonb_build_object('independent', true, 'shared', true,
      'verses_practiced', (select count(*) from memory.cards k where k.profile_id = c.account_id and k.sessions > 0),
      'review_ready', (select count(*) from memory.cards k where k.profile_id = c.account_id and k.best_step >= 3),
      'days_practiced_28', (select count(distinct a.local_date) from memory.attempts a where a.profile_id = c.account_id
                             and a.created_at > now() - interval '28 days'),
      'badges', coalesce((select jsonb_agg(b.name order by b.sort_order) from memory.awards w join memory.badges b on b.key = w.badge_key
                           where w.profile_id = c.account_id and w.scope = ''), '[]'::jsonb),
      'reading_days_28', (select count(*) from bible.completions bc join bible.enrollments e on e.id = bc.enrollment_id
                           where e.profile_id = c.account_id and bc.completed_at > now() - interval '28 days'));
  end if;
  return jsonb_build_object('independent', false, 'shared', true,
    'verses_practiced', (select count(*) from youth.practice_cards k where k.child_id = c.id and k.sessions > 0),
    'review_ready', (select count(*) from youth.practice_cards k where k.child_id = c.id and k.best_step >= 3),
    'days_practiced_28', (select count(distinct a.local_date) from youth.practice_attempts a where a.child_id = c.id
                           and a.created_at > now() - interval '28 days'),
    'activities_7', (select count(*) from youth.practice_attempts a where a.child_id = c.id and a.created_at > now() - interval '7 days'));
end;
$$;

revoke execute on all functions in schema youth from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261028000700', 'youth_communication_learning', 'phase-10');

commit;
