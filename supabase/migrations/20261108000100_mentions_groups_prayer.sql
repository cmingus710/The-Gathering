-- Mentions · groups in Community, and people and groups in Prayer (additive).
--
-- Extends 20261107000100_community_mentions (people in Community posts and
-- comments) into one mention system for four places: Community posts,
-- Community comments, prayer requests, and prayer comments.
--
-- Markup. People stay `@[Name](mention:<member id>)`; groups are
--   @[Group name](group:<group id>)
-- Ids are what count; the label is the name when it was written. Older app
-- versions show group markup as plain "@Group name" text.
--
-- Referencing a group vs notifying it.
--   * A group can be REFERENCED when it's listed in the group directory
--     (discoverable and active), or when the content is posted in that same
--     group (a group post, or a prayer request shared with that group) by
--     one of its members. So a hidden group's name only ever appears where
--     every reader already belongs to it. Names are also redacted at read
--     time for anyone who can't see the group (e.g. it was hidden later).
--   * Its members are NOTIFIED only when the group's setting allows the
--     author (community.groups.mention_notify: 'leaders' = leaders and
--     community moderators who belong to it, the default; 'members'; 'off'),
--     and never from anonymous prayer content (it would hint at who wrote
--     it). Otherwise the group is mentioned without notifying anyone, and
--     the composer says so before posting.
--   * Recipients are captured when the mention is created: active members
--     of the group who can read the content (for a group post or a group
--     prayer request, members of both groups), never the author, never
--     anyone blocked either way, and not anyone who muted the group.
--     Joining later never brings old mention alerts.
--   * At most community.settings.group_mention_limit groups (default 3) per
--     post, request, or comment; group fan-out is rate-limited per author.
--     No @everyone or @all.
--
-- Who can be mentioned (people): unchanged for Community
-- (community.can_mention). Prayer uses the same rule against the request's
-- audience: church-wide → any listed adult member; a group → that group's
-- members. The author's own access to their request is deliberately NOT a
-- reason someone can be mentioned, so suggestions never single out the
-- writer of an anonymous request. Confidential (prayer team) requests take
-- no mentions; private drafts aren't checked or recorded until shared.
--
-- Saving. Before-triggers on community.threads/posts and prayer.requests/
-- comments now REJECT a save that mentions anyone or any group that isn't
-- allowed there (forged ids included), naming what to remove, instead of
-- quietly turning it into text. Changing a prayer request's audience runs
-- the same check, so narrowing never leaves a mention that its person can't
-- see (the composer explains first). After-triggers record mentions and
-- notify in the same transaction.
--
-- Delivery. community.mention_deliveries holds one row per (content, person)
-- ever: a person mentioned by name and through one or more groups gets one
-- notice; retries, concurrent saves, unchanged mentions, and remove/re-add
-- never notify again; edits notify only newly added people. Notices use the
-- existing notification, email, and push outboxes (quiet hours, blocks,
-- mutes, preferences). New kinds: group_mention, prayer_mention,
-- prayer_group_mention; new category group_mentions ("My group is
-- mentioned"). Every read and every email/push claim rechecks status,
-- membership, access, and that the mention is still there; queued email and
-- push are also cancelled at once when a mention is removed, content is
-- hidden, deleted, narrowed, or archived, or a member leaves a group.
-- Prayer email and push are always generic and never name anyone.

-- ---------------------------------------------------------------------------
-- Settings and records
-- ---------------------------------------------------------------------------
alter table community.settings
  add column group_mention_limit smallint not null default 3 check (group_mention_limit between 1 and 10);

alter table community.groups
  add column mention_notify text not null default 'leaders' check (mention_notify in ('leaders', 'members', 'off'));

alter table community.notifications drop constraint notifications_kind_check;
alter table community.notifications add constraint notifications_kind_check check (kind in (
  'reply_followed', 'reply_mine', 'group_invitation', 'group_request', 'group_request_approved',
  'group_request_declined', 'group_removed', 'group_role', 'message', 'moderation', 'event',
  'prayer_comment', 'prayer_update', 'prayer_answered', 'prayer_moderation',
  'care_assigned', 'care_response', 'care_volunteer', 'care_follow_up',
  'content_new', 'gallery_new', 'gallery_outcome',
  'reading_reminder', 'reading_plan_changed',
  'memory_weekly_verse', 'memory_review_due', 'memory_practice_reminder', 'memory_challenge_milestone',
  'youth_announcement', 'youth_family', 'youth_registration', 'youth_event_reminder', 'youth_form_needed',
  'youth_consent_changed', 'youth_learning', 'youth_report',
  'mention', 'group_mention', 'prayer_mention', 'prayer_group_mention'));
alter table community.notifications drop constraint notifications_category_check;
alter table community.notifications add constraint notifications_category_check
  check (category in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions', 'group_mentions'));
alter table community.notification_prefs drop constraint notification_prefs_category_check;
alter table community.notification_prefs add constraint notification_prefs_category_check
  check (category in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions', 'group_mentions'));

-- Groups mentioned in a Community post (post_id null) or comment.
create table community.group_mentions (
  thread_id uuid not null references community.threads (id) on delete cascade,
  post_id uuid references community.posts (id) on delete cascade,
  target_id uuid generated always as (coalesce(post_id, thread_id)) stored,
  group_id uuid not null references community.groups (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  -- Whether the author could notify the group when it was (re)added.
  notify boolean not null default false,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  -- Set once the group's members were notified for this content (never again).
  notified_at timestamptz,
  primary key (target_id, group_id)
);
create index group_mentions_group_idx on community.group_mentions (group_id);
create index group_mentions_thread_idx on community.group_mentions (thread_id);
create index group_mentions_post_idx on community.group_mentions (post_id) where post_id is not null;
create index group_mentions_author_idx on community.group_mentions (author_id);
alter table community.group_mentions enable row level security;

-- People mentioned in a prayer request (comment_id null) or prayer comment.
create table prayer.mentions (
  request_id uuid not null references prayer.requests (id) on delete cascade,
  comment_id uuid references prayer.comments (id) on delete cascade,
  target_id uuid generated always as (coalesce(comment_id, request_id)) stored,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (target_id, profile_id)
);
create index prayer_mentions_profile_idx on prayer.mentions (profile_id);
create index prayer_mentions_request_idx on prayer.mentions (request_id);
create index prayer_mentions_comment_idx on prayer.mentions (comment_id) where comment_id is not null;
create index prayer_mentions_author_idx on prayer.mentions (author_id);
alter table prayer.mentions enable row level security;

create table prayer.group_mentions (
  request_id uuid not null references prayer.requests (id) on delete cascade,
  comment_id uuid references prayer.comments (id) on delete cascade,
  target_id uuid generated always as (coalesce(comment_id, request_id)) stored,
  group_id uuid not null references community.groups (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  notify boolean not null default false,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  notified_at timestamptz,
  primary key (target_id, group_id)
);
create index prayer_group_mentions_group_idx on prayer.group_mentions (group_id);
create index prayer_group_mentions_request_idx on prayer.group_mentions (request_id);
create index prayer_group_mentions_comment_idx on prayer.group_mentions (comment_id) where comment_id is not null;
create index prayer_group_mentions_author_idx on prayer.group_mentions (author_id);
alter table prayer.group_mentions enable row level security;

-- One row per (post/comment/request, person) ever notified about a mention,
-- whether by name or through a group. The primary key is the dedupe: a
-- concurrent save waits on it and then inserts nothing.
create table community.mention_deliveries (
  target_id uuid not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('community', 'prayer')),
  -- The discussion (thread) or prayer request the target belongs to.
  context_id uuid not null,
  -- Null: mentioned by name. Otherwise the group they were reached through.
  via_group uuid references community.groups (id) on delete set null,
  notification_id uuid references community.notifications (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (target_id, profile_id)
);
create index mention_deliveries_profile_idx on community.mention_deliveries (profile_id);
create index mention_deliveries_context_idx on community.mention_deliveries (context_id);
create index mention_deliveries_group_idx on community.mention_deliveries (via_group) where via_group is not null;
create index mention_deliveries_notification_idx on community.mention_deliveries (notification_id) where notification_id is not null;
alter table community.mention_deliveries enable row level security;

-- People already notified under 20261107000100 count as delivered.
insert into community.mention_deliveries (target_id, profile_id, source, context_id, notification_id, created_at)
select m.target_id, m.profile_id, 'community', m.thread_id, m.notification_id, m.notified_at
  from community.mentions m
 where m.notified_at is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Markup helpers
-- ---------------------------------------------------------------------------
-- Matches one group mention: 1 = label, 2 = group id.
create function community.group_mention_pattern()
returns text
language sql
immutable
set search_path = ''
as $$
  select '@\[([^][\n]{1,80})\]\(group:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)';
$$;

create function community.group_mention_ids(p_body text)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x.id order by x.first), '{}')
    from (select lower(m[2])::uuid as id, min(o) as first
            from regexp_matches(coalesce(p_body, ''), community.group_mention_pattern(), 'g') with ordinality as r(m, o)
           group by 1) x;
$$;

-- The text with every mention (people and groups) shown as "@Label".
create or replace function community.mention_plain(p_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(regexp_replace(coalesce(p_body, ''), community.mention_pattern(), '@\1', 'g'),
                        community.group_mention_pattern(), '@\1', 'g');
$$;

-- "@Label" as first written for one id (p_kind: mention | group), for
-- error messages that tell the author what to remove.
create function community.mention_label(p_body text, p_kind text, p_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select '@' || coalesce((regexp_match(coalesce(p_body, ''),
                  '@\[([^][\n]{1,80})\]\(' || p_kind || ':' || p_id::text || '\)', 'i'))[1], 'someone');
$$;

-- "a", "a and b", "a, b, and c".
create function community.join_names(p_names text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case cardinality(p_names)
           when 0 then ''
           when 1 then p_names[1]
           when 2 then p_names[1] || ' and ' || p_names[2]
           else array_to_string(p_names[1:cardinality(p_names) - 1], ', ') || ', and ' || p_names[cardinality(p_names)] end;
$$;

-- The text as one reader may receive it: a group they can't see (hidden, or
-- archived and they aren't in it) is labelled only "Group".
create function community.mention_redact(p_body text, p_viewer uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := p_body;
  v_id uuid;
begin
  if p_body is null or position('](group:' in p_body) = 0 then
    return p_body;
  end if;
  foreach v_id in array community.group_mention_ids(p_body) loop
    if not community.can_see_group(v_id, p_viewer) then
      v := regexp_replace(v, '@\[[^][\n]{1,80}\]\(group:' || v_id::text || '\)', '@[Group](group:' || v_id::text || ')', 'gi');
    end if;
  end loop;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who and what may be mentioned (shared by Community and Prayer). p_place is
-- the group a place is limited to: a group post, or a prayer request shared
-- with a group; null for church-wide.
-- ---------------------------------------------------------------------------
create function community.can_reference_group(p_author uuid, p_group uuid, p_place uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select community.is_member(p_author) and exists (
    select 1 from community.groups g
     where g.id = p_group and g.status = 'active'
       and (g.visibility = 'discoverable' or (g.id = p_place and community.group_member(g.id, p_author))));
$$;

-- Whether a person holds a community capability through a role (any
-- approved member, not only the caller).
create function community.holds(p_profile uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
     where p.id = p_profile and p.membership_status = 'approved' and p.account_kind = 'adult'
       and ((ur.role_key = 'super_admin' and p_capability like 'community.%')
            or exists (select 1 from public.role_capabilities rc join public.capabilities c on c.key = rc.capability_key
                        where rc.role_key = ur.role_key and rc.capability_key = p_capability and c.available)));
$$;

-- The group's "Who can notify this group through @mentions?" setting.
create function community.can_notify_group(p_author uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case g.mention_notify
             when 'members' then community.group_member(g.id, p_author)
             when 'leaders' then community.group_leader(g.id, p_author)
                                 or (community.group_member(g.id, p_author) and community.holds(p_author, 'community.moderate'))
             else false end
      from community.groups g where g.id = p_group and g.status = 'active'), false);
$$;

-- For the composer: notify | leaders | members | off (why it won't notify).
create function community.group_notify_state(p_author uuid, p_group uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when community.can_notify_group(p_author, p_group) then 'notify'
              else coalesce((select g.mention_notify from community.groups g where g.id = p_group), 'off') end;
$$;

-- People a group mention reaches right now (captured once, when created).
create function community.group_mention_recipients(p_author uuid, p_group uuid, p_place uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.profile_id
    from community.group_members m
   where m.group_id = p_group and m.state = 'active'
     and m.profile_id is distinct from p_author
     and community.group_member(p_group, m.profile_id)
     and (p_place is null or community.group_member(p_place, m.profile_id))
     and (p_author is null or not community.blocked_either(p_author, m.profile_id));
$$;

-- Rejects mentions that aren't allowed here, naming them. p_noun says what
-- is being saved ("post", "prayer request").
create function community.mentions_check(p_body text, p_author uuid, p_place uuid, p_noun text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_people uuid[];
  v_groups uuid[];
  v_bad text[] := '{}';
  v_id uuid;
  v_limit integer;
begin
  if p_body is null or (position('](mention:' in p_body) = 0 and position('](group:' in p_body) = 0) then
    return;
  end if;
  v_people := community.mention_ids(p_body);
  v_groups := community.group_mention_ids(p_body);
  if cardinality(v_people) > 10 then
    raise exception 'You can mention up to 10 people in one post or comment.' using errcode = '22023';
  end if;
  select coalesce(max(group_mention_limit), 3) into v_limit from community.settings;
  if cardinality(v_groups) > v_limit then
    raise exception 'You can mention up to % groups in one post or comment.', v_limit using errcode = '22023';
  end if;
  foreach v_id in array v_people loop
    if not community.can_mention(p_author, v_id, p_place) then
      v_bad := v_bad || community.mention_label(p_body, 'mention', v_id);
    end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception '% can''t be mentioned here. You can mention only members who can already see this %; a mention never shares it with anyone else. Remove the mention and try again.',
      community.join_names(v_bad), p_noun using errcode = '22023';
  end if;
  foreach v_id in array v_groups loop
    if not community.can_reference_group(p_author, v_id, p_place) then
      v_bad := v_bad || community.mention_label(p_body, 'group', v_id);
    end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception '% can''t be mentioned here. You can mention groups listed in the group directory, or the group this % is shared with. Remove the mention and try again.',
      community.join_names(v_bad), p_noun using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery (shared). Notifies people mentioned by name, then the captured
-- members of groups that may be notified, once per person per target.
-- ---------------------------------------------------------------------------
create function community.mention_deliver(
  p_source text, p_target uuid, p_context uuid, p_author uuid, p_place uuid,
  p_people uuid[], p_groups uuid[], p_refs jsonb, p_person_kind text, p_group_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p uuid;
  v_g uuid;
  v_n uuid;
  v_detail jsonb := coalesce(p_refs -> 'detail', '{}'::jsonb);
begin
  foreach v_p in array coalesce(p_people, '{}') loop
    continue when v_p is not distinct from p_author;
    insert into community.mention_deliveries (target_id, profile_id, source, context_id)
    values (p_target, v_p, p_source, p_context)
    on conflict do nothing;
    continue when not found;
    perform community.rate_limit(p_author, 'mention', 50, interval '1 hour');
    v_n := community.notify(v_p, p_person_kind, p_author,
                            p_refs || jsonb_build_object('detail', v_detail || jsonb_build_object('via', 'member')),
                            'mention:' || p_target);
    update community.mention_deliveries set notification_id = v_n where target_id = p_target and profile_id = v_p;
  end loop;
  foreach v_g in array coalesce(p_groups, '{}') loop
    perform community.rate_limit(p_author, 'group_mention', 20, interval '1 hour');
    for v_p in
      select x from community.group_mention_recipients(p_author, v_g, p_place) x
       where not exists (select 1 from community.mutes m
                          where m.profile_id = x and m.target_type = 'group' and m.target_id in (v_g, p_place))
       order by x
    loop
      insert into community.mention_deliveries (target_id, profile_id, source, context_id, via_group)
      values (p_target, v_p, p_source, p_context, v_g)
      on conflict do nothing;
      continue when not found;
      v_n := community.notify(v_p, p_group_kind, p_author,
                              p_refs || jsonb_build_object('group_id', v_g,
                                'detail', v_detail || jsonb_build_object('via', 'group', 'group_id', v_g)),
                              'mention:' || p_target);
      update community.mention_deliveries set notification_id = v_n where target_id = p_target and profile_id = v_p;
    end loop;
  end loop;
end;
$$;

-- Cancels queued email and push for mention notices in one discussion or
-- prayer request that can no longer be shown (mention removed, content
-- hidden or deleted, audience narrowed, access lost).
create function community.mention_cancel(p_context uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update community.email_outbox e set status = 'skipped', updated_at = now()
    from community.mention_deliveries d
    join community.notifications n on n.id = d.notification_id
   where d.context_id = p_context and e.notification_id = n.id
     and e.status in ('pending', 'failed') and not community.notification_visible(n);
  update community.push_outbox p set status = 'skipped', updated_at = now()
    from community.mention_deliveries d
    join community.notifications n on n.id = d.notification_id
   where d.context_id = p_context and p.notification_id = n.id
     and p.status in ('pending', 'failed') and not community.notification_visible(n);
end;
$$;

-- The same for everything one person was notified about (they left a
-- group, or their account stopped being approved).
create function community.mention_cancel_for(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update community.email_outbox e set status = 'skipped', updated_at = now()
    from community.mention_deliveries d
    join community.notifications n on n.id = d.notification_id
   where d.profile_id = p_profile and e.notification_id = n.id
     and e.status in ('pending', 'failed') and not community.notification_visible(n);
  update community.push_outbox p set status = 'skipped', updated_at = now()
    from community.mention_deliveries d
    join community.notifications n on n.id = d.notification_id
   where d.profile_id = p_profile and p.notification_id = n.id
     and p.status in ('pending', 'failed') and not community.notification_visible(n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Community: saving (the triggers from 20261107000100 call these)
-- ---------------------------------------------------------------------------
-- Before a save: refuse mentions that aren't allowed here (the text is
-- saved as written otherwise).
create or replace function community.mentions_clean(p_body text, p_author uuid, p_group uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform community.mentions_check(p_body, p_author, p_group, 'post');
  return p_body;
end;
$$;

-- After a save: record people and groups, mark removed ones, notify (once
-- per person), and cancel queued alerts that no longer apply.
create or replace function community.mentions_sync(p_thread uuid, p_post uuid, p_author uuid, p_body text, p_group uuid, p_publish boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_post, p_thread);
  v_ids uuid[];
  v_groups uuid[];
  v_notify uuid[];
begin
  select coalesce(array_agg(x), '{}') into v_ids
    from unnest(community.mention_ids(p_body)) x
   where community.can_mention(p_author, x, p_group);
  select coalesce(array_agg(x), '{}') into v_groups
    from unnest(community.group_mention_ids(p_body)) x
   where community.can_reference_group(p_author, x, p_group);

  update community.mentions set removed_at = now()
   where target_id = v_target and removed_at is null and not (profile_id = any (v_ids));
  insert into community.mentions (thread_id, post_id, profile_id, author_id)
  select p_thread, p_post, x, p_author from unnest(v_ids) x
  on conflict (target_id, profile_id) do update set removed_at = null
   where community.mentions.removed_at is not null;

  update community.group_mentions set removed_at = now()
   where target_id = v_target and removed_at is null and not (group_id = any (v_groups));
  insert into community.group_mentions (thread_id, post_id, group_id, author_id, notify)
  select p_thread, p_post, x, p_author, community.can_notify_group(p_author, x) from unnest(v_groups) x
  on conflict (target_id, group_id) do update set removed_at = null, notify = excluded.notify
   where community.group_mentions.removed_at is not null;

  if p_publish then
    select coalesce(array_agg(g.group_id order by g.created_at, g.group_id), '{}') into v_notify
      from community.group_mentions g
     where g.target_id = v_target and g.removed_at is null and g.notify and g.notified_at is null;
    perform community.mention_deliver('community', v_target, p_thread, p_author, p_group,
      array(select m.profile_id from community.mentions m
             where m.target_id = v_target and m.removed_at is null and m.notified_at is null
             order by m.created_at, m.profile_id),
      v_notify,
      jsonb_build_object('thread_id', p_thread, 'post_id', p_post),
      'mention', 'group_mention');
    update community.mentions m
       set notified_at = now(),
           notification_id = (select d.notification_id from community.mention_deliveries d
                               where d.target_id = v_target and d.profile_id = m.profile_id)
     where m.target_id = v_target and m.removed_at is null and m.notified_at is null
       and m.profile_id is distinct from p_author;
    update community.group_mentions set notified_at = now()
     where target_id = v_target and group_id = any (v_notify);
  end if;
  perform community.mention_cancel(p_thread);
end;
$$;

-- Whether a mention notice about this post or comment still reaches the
-- person: still mentioned by name, or still in a group that is still
-- mentioned there with notification.
create function community.mention_reaches(p_target uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from community.mentions m
                  where m.target_id = p_target and m.profile_id = p_profile and m.removed_at is null)
      or exists (select 1 from community.group_mentions g
                  where g.target_id = p_target and g.removed_at is null and g.notify and g.notified_at is not null
                    and community.group_member(g.group_id, p_profile));
$$;

-- Hiding, deleting, or restoring a post or comment.
create function community.threads_mentions_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform community.mention_cancel(new.id);
  return null;
end;
$$;

create function community.posts_mentions_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform community.mention_cancel(new.thread_id);
  return null;
end;
$$;

create trigger threads_mentions_status after update of status on community.threads
  for each row when (old.status is distinct from new.status) execute function community.threads_mentions_status();
create trigger posts_mentions_status after update of status on community.posts
  for each row when (old.status is distinct from new.status) execute function community.posts_mentions_status();

-- Leaving a group, or an account no longer approved.
create function community.mentions_on_membership_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform community.mention_cancel_for(new.profile_id);
  return null;
end;
$$;

create trigger group_members_mentions_cancel after update of state on community.group_members
  for each row when (old.state = 'active' and new.state <> 'active') execute function community.mentions_on_membership_end();

create function community.mentions_on_profile_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform community.mention_cancel_for(new.id);
  return null;
end;
$$;

create trigger profiles_mentions_cancel after update of membership_status on public.profiles
  for each row when (old.membership_status = 'approved' and new.membership_status <> 'approved')
  execute function community.mentions_on_profile_status();

-- ---------------------------------------------------------------------------
-- Prayer: saving
-- ---------------------------------------------------------------------------
-- The group a request's readers are limited to (null: church-wide).
create function prayer.mention_place(r prayer.requests)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when r.audience = 'group' then r.group_id end;
$$;

create function prayer.mentions_check(r prayer.requests, p_body text, p_author uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_body is null or (position('](mention:' in p_body) = 0 and position('](group:' in p_body) = 0) then
    return;
  end if;
  -- A private draft: checked when it's shared.
  if r.audience = 'private' then
    return;
  end if;
  if r.audience = 'team' then
    raise exception 'Mentions aren''t available on confidential (prayer team) requests. Remove the @mentions, or choose a different audience.'
      using errcode = '22023';
  end if;
  perform community.mentions_check(p_body, p_author, prayer.mention_place(r), 'prayer request');
end;
$$;

create function prayer.mention_reaches(p_target uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from prayer.mentions m
                  where m.target_id = p_target and m.profile_id = p_profile and m.removed_at is null)
      or exists (select 1 from prayer.group_mentions g
                  where g.target_id = p_target and g.removed_at is null and g.notify and g.notified_at is not null
                    and community.group_member(g.group_id, p_profile));
$$;

-- After a save. p_anonymous: written anonymously (an anonymous request, or
-- the requester's anonymous comment), so groups are never notified.
create function prayer.mentions_sync(r prayer.requests, p_comment uuid, p_author uuid, p_body text, p_anonymous boolean, p_publish boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_comment, r.id);
  v_place uuid := prayer.mention_place(r);
  v_ids uuid[] := '{}';
  v_groups uuid[] := '{}';
  v_notify uuid[];
begin
  if r.audience in ('church', 'group') then
    select coalesce(array_agg(x), '{}') into v_ids
      from unnest(community.mention_ids(p_body)) x
     where community.can_mention(p_author, x, v_place);
    select coalesce(array_agg(x), '{}') into v_groups
      from unnest(community.group_mention_ids(p_body)) x
     where community.can_reference_group(p_author, x, v_place);
  end if;

  update prayer.mentions set removed_at = now()
   where target_id = v_target and removed_at is null and not (profile_id = any (v_ids));
  insert into prayer.mentions (request_id, comment_id, profile_id, author_id)
  select r.id, p_comment, x, p_author from unnest(v_ids) x
  on conflict (target_id, profile_id) do update set removed_at = null
   where prayer.mentions.removed_at is not null;

  update prayer.group_mentions set removed_at = now()
   where target_id = v_target and removed_at is null and not (group_id = any (v_groups));
  insert into prayer.group_mentions (request_id, comment_id, group_id, author_id, notify)
  select r.id, p_comment, x, p_author, not coalesce(p_anonymous, false) and community.can_notify_group(p_author, x)
    from unnest(v_groups) x
  on conflict (target_id, group_id) do update set removed_at = null, notify = excluded.notify
   where prayer.group_mentions.removed_at is not null;

  if p_publish and r.audience in ('church', 'group') and r.status in ('open', 'answered') and r.hidden_at is null then
    select coalesce(array_agg(g.group_id order by g.created_at, g.group_id), '{}') into v_notify
      from prayer.group_mentions g
     where g.target_id = v_target and g.removed_at is null and g.notify and g.notified_at is null;
    perform community.mention_deliver('prayer', v_target, r.id, p_author, v_place,
      array(select m.profile_id from prayer.mentions m
             where m.target_id = v_target and m.removed_at is null
             order by m.created_at, m.profile_id),
      v_notify,
      jsonb_build_object('prayer_request_id', r.id, 'detail', jsonb_build_object('comment_id', p_comment)),
      'prayer_mention', 'prayer_group_mention');
    update prayer.group_mentions set notified_at = now()
     where target_id = v_target and group_id = any (v_notify);
  end if;
  perform community.mention_cancel(r.id);
end;
$$;

create function prayer.requests_mentions_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body and new.audience = old.audience
     and new.group_id is not distinct from old.group_id then
    return new;
  end if;
  perform prayer.mentions_check(new, new.body, new.author_id);
  return new;
end;
$$;

create function prayer.requests_mentions_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body and new.audience = old.audience
     and new.group_id is not distinct from old.group_id then
    return null;
  end if;
  perform prayer.mentions_sync(new, null, new.author_id, new.body, new.anonymous, true);
  return null;
end;
$$;

create function prayer.requests_mentions_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform community.mention_cancel(new.id);
  return null;
end;
$$;

-- Deliveries for a deleted request have nothing left to point at.
create function prayer.requests_mentions_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from community.mention_deliveries where source = 'prayer' and context_id = old.id;
  return null;
end;
$$;

create function prayer.comments_mentions_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r prayer.requests;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;
  select * into r from prayer.requests where id = new.request_id;
  perform prayer.mentions_check(r, new.body, new.author_id);
  return new;
end;
$$;

create function prayer.comments_mentions_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r prayer.requests;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return null;
  end if;
  select * into r from prayer.requests where id = new.request_id;
  perform prayer.mentions_sync(r, new.id, new.author_id, new.body, new.anonymous, new.status = 'visible');
  return null;
end;
$$;

create function prayer.comments_mentions_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform community.mention_cancel(new.request_id);
  return null;
end;
$$;

create trigger requests_mentions_check before insert or update of body, audience, group_id on prayer.requests
  for each row execute function prayer.requests_mentions_check();
create trigger requests_mentions_sync after insert or update of body, audience, group_id on prayer.requests
  for each row execute function prayer.requests_mentions_sync();
create trigger requests_mentions_status after update of status, hidden_at on prayer.requests
  for each row execute function prayer.requests_mentions_status();
create trigger requests_mentions_deleted after delete on prayer.requests
  for each row execute function prayer.requests_mentions_deleted();
create trigger comments_mentions_check before insert or update of body on prayer.comments
  for each row execute function prayer.comments_mentions_check();
create trigger comments_mentions_sync after insert or update of body on prayer.comments
  for each row execute function prayer.comments_mentions_sync();
create trigger comments_mentions_status after update of status on prayer.comments
  for each row when (old.status is distinct from new.status) execute function prayer.comments_mentions_status();

-- Whether a prayer mention notice may still be shown: the request (and the
-- comment) is visible and shared, the person can still read it (and was in
-- the comment's audience), the mention is still there, and they haven't
-- blocked whoever wrote it.
create function prayer.mention_notice_visible(n community.notifications)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from prayer.requests r
     where r.id = n.prayer_request_id and r.status <> 'archived' and r.hidden_at is null
       and r.audience in ('church', 'group') and prayer.can_read(r, n.profile_id)
       and prayer.mention_reaches(coalesce(nullif(n.detail ->> 'comment_id', '')::uuid, r.id), n.profile_id)
       and (nullif(n.detail ->> 'comment_id', '') is null or exists (
             select 1 from prayer.comments c
              where c.id = (n.detail ->> 'comment_id')::uuid and c.request_id = r.id and c.status = 'visible'
                and prayer.sees_item(r, c.posted_audience, c.posted_group, c.author_id, n.profile_id))))
     and not exists (select 1 from community.blocks b where b.blocker_id = n.profile_id and b.blocked_id = n.actor_id);
$$;

-- ---------------------------------------------------------------------------
-- Reading: mentions with each post, comment, and request
-- ---------------------------------------------------------------------------
-- A group mention as one reader sees it: its current name and a link only
-- if the reader may see the group.
create function community.group_ref(p_group uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p_group, 'kind', 'group',
           'name', case when community.can_see_group(p_group, p_viewer) then (select g.name from community.groups g where g.id = p_group) end,
           'listed', community.can_see_group(p_group, p_viewer));
$$;

create function community.mentions_all_json(p_thread uuid, p_post uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select community.mentions_json(p_thread, p_post)
         || coalesce((select jsonb_agg(community.group_ref(g.group_id, p_viewer) order by g.created_at, g.group_id)
                        from community.group_mentions g
                       where g.target_id = coalesce(p_post, p_thread) and g.removed_at is null), '[]'::jsonb);
$$;

create function prayer.mentions_json(p_target uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_agg(jsonb_build_object(
                     'id', m.profile_id,
                     'name', case when community.is_member(m.profile_id) then community.display_name(m.profile_id) end,
                     'listed', public.directory_is_listed(m.profile_id)) order by m.created_at, m.profile_id)
                     from prayer.mentions m where m.target_id = p_target and m.removed_at is null), '[]'::jsonb)
         || coalesce((select jsonb_agg(community.group_ref(g.group_id, p_viewer) order by g.created_at, g.group_id)
                        from prayer.group_mentions g where g.target_id = p_target and g.removed_at is null), '[]'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- Suggestions (bounded, server-filtered)
-- ---------------------------------------------------------------------------
-- People p_viewer may mention where readers are limited to p_place (null:
-- church-wide): name, shared photo path, and shared city only; at most 8.
create function community.mention_people(p_viewer uuid, p_query text, p_place uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := left(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 60);
  v_like text;
  v_word text;
begin
  if char_length(v_q) < 1 then
    return '[]'::jsonb;
  end if;
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_word := v_like || '%';
  v_like := '%' || v_like || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'photo_path', x.photo_path, 'detail', x.detail)
                     order by x.rank, lower(x.name), x.id)
      from (select p.id, public.directory_display_name(p) as name,
                   case when d.show_photo then d.photo_path end as photo_path,
                   case when d.show_city_state or d.show_street_address
                        then nullif(concat_ws(', ', nullif(btrim(d.city), ''), nullif(btrim(d.state_region), '')), '') end as detail,
                   case when public.directory_display_name(p) ilike v_word
                          or public.directory_display_name(p) ilike '% ' || v_word
                          or p.full_name ilike v_word or p.full_name ilike '% ' || v_word then 0 else 1 end as rank
              from public.profiles p
              join public.member_profile_details d on d.profile_id = p.id
             where p.id <> p_viewer
               and p.membership_status = 'approved' and p.account_kind = 'adult' and d.directory_listed
               and (p.full_name ilike v_like or p.preferred_name ilike v_like)
               and (p_place is null or community.group_member(p_place, p.id))
               and not community.blocked_either(p_viewer, p.id)
             order by 5, lower(public.directory_display_name(p)), p.id
             limit 8) x), '[]'::jsonb);
end;
$$;

-- Groups p_viewer may mention there, at most 5: name, image path, whether
-- choosing it will notify (notify | leaders | members | off | anonymous),
-- and, only when it will, how many people it reaches (the author is then a
-- member and can see the roster anyway).
create function community.mention_groups(p_viewer uuid, p_query text, p_place uuid, p_anonymous boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := left(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 60);
  v_like text;
  v_word text;
begin
  if char_length(v_q) < 1 then
    return '[]'::jsonb;
  end if;
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_word := v_like || '%';
  v_like := '%' || v_like || '%';
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'name', x.name, 'image_path', x.image_path, 'notify', x.state,
             'reach', case when x.state = 'notify' then (select count(*) from community.group_mention_recipients(p_viewer, x.id, p_place)) end)
           order by x.rank, lower(x.name), x.id)
      from (select g.id, g.name, g.image_path,
                   case when coalesce(p_anonymous, false) then 'anonymous' else community.group_notify_state(p_viewer, g.id) end as state,
                   case when g.name ilike v_word or g.name ilike '% ' || v_word then 0 else 1 end as rank
              from community.groups g
             where g.status = 'active' and g.name ilike v_like
               and (g.visibility = 'discoverable' or (g.id = p_place and community.group_member(g.id, p_viewer)))
             order by 5, lower(g.name), g.id
             limit 5) x), '[]'::jsonb);
end;
$$;

-- Community: the original people-only search, now sharing the query above.
create or replace function public.community_mention_search(p_query text, p_thread uuid default null, p_category uuid default null, p_group uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_group uuid;
begin
  if p_thread is not null then
    if not community.can_read_thread(p_thread, v_uid) then
      return '[]'::jsonb;
    end if;
    select group_id into v_group from community.threads where id = p_thread;
  elsif p_group is not null then
    if not community.group_member(p_group, v_uid) then
      return '[]'::jsonb;
    end if;
    v_group := p_group;
  elsif p_category is null or not exists (select 1 from community.categories where id = p_category and active) then
    return '[]'::jsonb;
  end if;
  if char_length(btrim(coalesce(p_query, ''))) < 1 then
    return '[]'::jsonb;
  end if;
  perform community.rate_limit(v_uid, 'mention_search', 300, interval '10 minutes');
  return community.mention_people(v_uid, p_query, v_group);
end;
$$;

-- Community: people and groups for one place (an existing post, or a new
-- post's category or group).
create function public.community_mention_suggest(p_query text, p_thread uuid default null, p_category uuid default null, p_group uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_group uuid;
  v_empty jsonb := jsonb_build_object('members', '[]'::jsonb, 'groups', '[]'::jsonb);
begin
  if p_thread is not null then
    if not community.can_read_thread(p_thread, v_uid) then
      return v_empty;
    end if;
    select group_id into v_group from community.threads where id = p_thread;
  elsif p_group is not null then
    if not community.group_member(p_group, v_uid) then
      return v_empty;
    end if;
    v_group := p_group;
  elsif p_category is null or not exists (select 1 from community.categories where id = p_category and active) then
    return v_empty;
  end if;
  if char_length(btrim(coalesce(p_query, ''))) < 1 then
    return v_empty;
  end if;
  perform community.rate_limit(v_uid, 'mention_search', 300, interval '10 minutes');
  return jsonb_build_object('members', community.mention_people(v_uid, p_query, v_group),
                            'groups', community.mention_groups(v_uid, p_query, v_group, false));
end;
$$;

-- Prayer: people and groups for a request being written (p_audience,
-- p_group, p_anonymous) or for a comment on p_request (p_anonymous: the
-- requester is commenting without their name). `unavailable` says why
-- there are none: team (confidential) or private (a draft).
create function public.prayer_mention_suggest(p_query text, p_request uuid default null, p_audience text default null,
                                               p_group uuid default null, p_anonymous boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  r prayer.requests;
  v_aud text;
  v_place uuid;
  v_anon boolean;
  v_empty jsonb := jsonb_build_object('members', '[]'::jsonb, 'groups', '[]'::jsonb);
begin
  if p_request is not null then
    select * into r from prayer.requests where id = p_request;
    if not found or not prayer.can_read(r, v_uid) then
      return v_empty;
    end if;
    v_aud := r.audience::text;
    v_place := prayer.mention_place(r);
    v_anon := r.author_id = v_uid and r.anonymous and coalesce(p_anonymous, true);
  else
    v_aud := coalesce(p_audience, '');
    if v_aud = 'group' then
      if p_group is null or not community.group_member(p_group, v_uid) then
        return v_empty;
      end if;
      v_place := p_group;
    end if;
    v_anon := coalesce(p_anonymous, false);
  end if;
  if v_aud in ('team', 'private') then
    return v_empty || jsonb_build_object('unavailable', v_aud);
  end if;
  if v_aud <> 'church' and v_aud <> 'group' then
    return v_empty;
  end if;
  if char_length(btrim(coalesce(p_query, ''))) < 1 then
    return v_empty;
  end if;
  perform community.rate_limit(v_uid, 'mention_search', 300, interval '10 minutes');
  return jsonb_build_object('members', community.mention_people(v_uid, p_query, v_place),
                            'groups', community.mention_groups(v_uid, p_query, v_place, v_anon));
end;
$$;

-- Prayer composer: before saving with a new audience, which of the chosen
-- people and groups couldn't be mentioned there, and which groups won't be
-- notified. Answers only about the ids given (at most 10 people and 10
-- groups), with ids only.
create function public.prayer_mention_check(p_audience text, p_group uuid, p_anonymous boolean, p_people uuid[], p_groups uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_place uuid;
begin
  if cardinality(coalesce(p_people, '{}')) > 10 or cardinality(coalesce(p_groups, '{}')) > 10 then
    raise exception 'Too many mentions to check.' using errcode = '22023';
  end if;
  if coalesce(p_audience, '') not in ('church', 'group', 'team', 'private') then
    raise exception 'Choose who can see your request.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'mention_search', 300, interval '10 minutes');
  if p_audience in ('team', 'private') then
    return jsonb_build_object('unavailable', p_audience, 'people', '[]'::jsonb, 'groups', '[]'::jsonb, 'quiet', '[]'::jsonb);
  end if;
  if p_audience = 'group' then
    if p_group is null or not community.group_member(p_group, v_uid) then
      raise exception 'Choose one of your active groups.' using errcode = '22023';
    end if;
    v_place := p_group;
  end if;
  return jsonb_build_object(
    'unavailable', null,
    'people', coalesce((select jsonb_agg(x) from unnest(p_people) x where not community.can_mention(v_uid, x, v_place)), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(x) from unnest(p_groups) x where not community.can_reference_group(v_uid, x, v_place)), '[]'::jsonb),
    'quiet', coalesce((select jsonb_agg(x) from unnest(p_groups) x
                        where community.can_reference_group(v_uid, x, v_place)
                          and (coalesce(p_anonymous, false) or not community.can_notify_group(v_uid, x))), '[]'::jsonb));
end;
$$;

-- Where a prayer comment falls among the comments the caller can see
-- (1-based), so a link can open enough of the conversation to show it.
-- Null if it isn't one they can see.
create function public.prayer_comment_position(p_request uuid, p_comment uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  r prayer.requests;
begin
  select * into r from prayer.requests where id = p_request;
  if not found or not prayer.can_read(r, v_uid) then
    return null;
  end if;
  return (select x.pos from (
            select c.id, row_number() over (order by c.created_at, c.id) as pos
              from prayer.comments c
             where c.request_id = r.id and prayer.sees_item(r, c.posted_audience, c.posted_group, c.author_id, v_uid)) x
           where x.id = p_comment);
end;
$$;

-- ---------------------------------------------------------------------------
-- Group setting: "Who can notify this group through @mentions?"
-- ---------------------------------------------------------------------------
create function public.community_group_set_mention_notify(p_group uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  g community.groups;
begin
  if coalesce(p_value, '') not in ('leaders', 'members', 'off') then
    raise exception 'Choose who can notify this group.' using errcode = '22023';
  end if;
  select * into g from community.groups where id = p_group for update;
  if not found or not community.can_manage_group(p_group) then
    raise exception 'That group wasn''t found.' using errcode = 'P0002';
  end if;
  if g.status = 'archived' then
    raise exception 'Archived groups can''t be edited. Restore it first.' using errcode = '22023';
  end if;
  if g.mention_notify = p_value then
    return;
  end if;
  perform community.rate_limit(v_uid, 'group_settings', 30, interval '15 minutes');
  update community.groups set mention_notify = p_value, updated_at = now() where id = g.id;
  perform community.audit('group.mention_notify_changed', 'group', g.id::text,
    jsonb_build_object('from', g.mention_notify, 'to', p_value));
end;
$$;

create or replace function community.group_card(g community.groups, p_viewer uuid)
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
    'mention_notify', g.mention_notify,
    'my_role', (select m.role from community.group_members m where m.group_id = g.id and m.profile_id = p_viewer and m.state = 'active'),
    'my_request', exists (select 1 from community.group_requests r where r.group_id = g.id and r.profile_id = p_viewer and r.status = 'pending'),
    'my_invitation', (select i.id from community.group_invitations i
                       where i.group_id = g.id and i.invitee_id = p_viewer and i.status = 'pending' and i.expires_at > now()));
$$;

-- ---------------------------------------------------------------------------
-- Shared notification functions and cards: the current definitions
-- (20261107000100; post_json from 20261022000300; prayer cards and
-- prayer_request from 20261024000300) with group and prayer mentions added.
-- prayer_request also opens up to 1,000 comments, so a link to an older
-- comment can show it.
-- ---------------------------------------------------------------------------
create or replace function community.kind_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('reply_followed', 'reply_mine') then 'forum'
    when p_kind in ('group_mention', 'prayer_group_mention') then 'group_mentions'
    when p_kind = 'prayer_mention' then 'mentions'
    when p_kind like 'group_%' then 'groups'
    when p_kind = 'message' then 'messages'
    when p_kind = 'event' then 'events'
    when p_kind in ('prayer_comment', 'prayer_update', 'prayer_answered') then 'prayer'
    when p_kind like 'care_%' then 'care'
    when p_kind = 'content_new' then 'teaching'
    when p_kind like 'gallery_%' then 'gallery'
    when p_kind like 'reading_%' then 'reading'
    when p_kind like 'memory_%' then 'memory'
    when p_kind like 'youth_%' then 'youth'
    when p_kind = 'mention' then 'mentions'
    else 'moderation'
  end;
$$;

create or replace function community.pref(p_profile uuid, p_category text)
returns table (in_app boolean, email text, push boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.in_app, true) or p_category = 'moderation',
         coalesce(p.email, case p_category when 'forum' then 'off' when 'events' then 'off' when 'prayer' then 'off' when 'teaching' then 'off' when 'gallery' then 'off' when 'mentions' then 'off' when 'group_mentions' then 'off' else 'immediate' end),
         coalesce(p.push, false)
    from (select 1) one
    left join community.notification_prefs p on p.profile_id = p_profile and p.category = p_category;
$$;

create or replace function community.notify(p_profile uuid, p_kind text, p_actor uuid, p_refs jsonb, p_merge_key text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text := community.kind_category(p_kind);
  v_pref record;
  v_id uuid;
  v_count integer;
  v_thread uuid := nullif(p_refs ->> 'thread_id', '')::uuid;
  v_group uuid := nullif(p_refs ->> 'group_id', '')::uuid;
  v_conv uuid := nullif(p_refs ->> 'conversation_id', '')::uuid;
  v_send_after timestamptz;
begin
  if p_profile is null or p_profile = p_actor or not community.is_member(p_profile) then
    return null;
  end if;
  if v_category <> 'moderation' then
    if p_actor is not null and exists (select 1 from community.blocks where blocker_id = p_profile and blocked_id = p_actor) then
      return null;
    end if;
    if exists (select 1 from community.mutes m
                where m.profile_id = p_profile
                  and ((m.target_type = 'thread' and m.target_id = v_thread)
                       or (m.target_type = 'group' and m.target_id = coalesce(v_group, (select group_id from community.threads where id = v_thread)))
                       or (m.target_type = 'conversation' and m.target_id = v_conv))) then
      return null;
    end if;
  end if;
  -- A reply that mentions someone (by name or through their group) already
  -- told them through the mention notice; don't also count it as a reply.
  if p_kind in ('reply_mine', 'reply_followed') and exists (
       select 1 from community.mention_deliveries d
        where d.target_id = nullif(p_refs ->> 'post_id', '')::uuid and d.profile_id = p_profile
          and d.notification_id is not null) then
    return null;
  end if;
  -- Likewise a prayer comment that mentions them (delivered in this same
  -- transaction, so now() matches).
  if p_kind = 'prayer_comment' and exists (
       select 1 from community.mention_deliveries d
        where d.source = 'prayer' and d.context_id = nullif(p_refs ->> 'prayer_request_id', '')::uuid
          and d.profile_id = p_profile and d.created_at = now() and d.notification_id is not null) then
    return null;
  end if;
  select * into v_pref from community.pref(p_profile, v_category);
  if not v_pref.in_app and v_pref.email = 'off' and not v_pref.push then
    return null;
  end if;

  if p_merge_key is not null then
    update community.notifications
       set count = count + 1, updated_at = now(), actor_id = p_actor,
           post_id = coalesce(nullif(p_refs ->> 'post_id', '')::uuid, post_id),
           detail = coalesce(p_refs -> 'detail', detail)
     where profile_id = p_profile and merge_key = p_merge_key and read_at is null
    returning id, count into v_id, v_count;
  end if;
  if v_id is null then
    insert into community.notifications (profile_id, kind, category, actor_id, thread_id, post_id, group_id, conversation_id,
                                         invitation_id, request_id, occurrence_id, prayer_request_id, care_request_id,
                                         care_opportunity_id, media_item_id, media_album_id, bible_enrollment_id, bible_plan_id,
                                         memory_item_id, memory_challenge_id, youth_child_id, youth_announcement_id,
                                         youth_request_id, youth_learning_id, youth_report_id, youth_series_id, detail, merge_key)
    values (p_profile, p_kind, v_category, p_actor, v_thread, nullif(p_refs ->> 'post_id', '')::uuid, v_group, v_conv,
            nullif(p_refs ->> 'invitation_id', '')::uuid, nullif(p_refs ->> 'request_id', '')::uuid,
            nullif(p_refs ->> 'occurrence_id', '')::uuid, nullif(p_refs ->> 'prayer_request_id', '')::uuid,
            nullif(p_refs ->> 'care_request_id', '')::uuid, nullif(p_refs ->> 'care_opportunity_id', '')::uuid,
            nullif(p_refs ->> 'media_item_id', '')::uuid, nullif(p_refs ->> 'media_album_id', '')::uuid,
            nullif(p_refs ->> 'bible_enrollment_id', '')::uuid, nullif(p_refs ->> 'bible_plan_id', '')::uuid,
            nullif(p_refs ->> 'memory_item_id', '')::uuid, nullif(p_refs ->> 'memory_challenge_id', '')::uuid,
            nullif(p_refs ->> 'youth_child_id', '')::uuid, nullif(p_refs ->> 'youth_announcement_id', '')::uuid,
            nullif(p_refs ->> 'youth_request_id', '')::uuid, nullif(p_refs ->> 'youth_learning_id', '')::uuid,
            nullif(p_refs ->> 'youth_report_id', '')::uuid, nullif(p_refs ->> 'series_id', '')::uuid,
            coalesce(p_refs -> 'detail', '{}'::jsonb), p_merge_key)
    returning id, count into v_id, v_count;
  end if;

  v_send_after := community.after_quiet(p_profile, now());
  -- One email per unread notification (merged activity doesn't re-email).
  if v_pref.email = 'immediate' and v_category <> 'events' then
    insert into community.email_outbox (dedupe_key, kind, profile_id, notification_id, send_after)
    values ('n:' || v_id, 'immediate', p_profile, v_id, v_send_after)
    on conflict (dedupe_key) do nothing;
  end if;
  if v_pref.push and exists (select 1 from community.push_subscriptions where profile_id = p_profile) then
    insert into community.push_outbox (dedupe_key, profile_id, notification_id, send_after)
    values ('n:' || v_id || ':' || v_count, p_profile, v_id, v_send_after)
    on conflict (dedupe_key) do nothing;
  end if;
  perform community.ping(p_profile, 'notification');
  return v_id;
end;
$$;

create or replace function community.notification_visible(n community.notifications)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select community.is_member(n.profile_id)
     and (select x.in_app from community.pref(n.profile_id, n.category) x)
     and case n.kind
       when 'reply_followed' then community.can_read_thread(n.thread_id, n.profile_id)
            and exists (select 1 from community.threads t where t.id = n.thread_id and t.status <> 'hidden')
       when 'reply_mine' then community.can_read_thread(n.thread_id, n.profile_id)
            and exists (select 1 from community.threads t where t.id = n.thread_id and t.status <> 'hidden')
       when 'group_invitation' then exists (
            select 1 from community.group_invitations i
              join community.groups g on g.id = i.group_id and g.status = 'active'
             where i.id = n.invitation_id and i.invitee_id = n.profile_id and i.status = 'pending' and i.expires_at > now())
       when 'group_request' then community.group_leader(n.group_id, n.profile_id)
            and exists (select 1 from community.group_requests r where r.id = n.request_id and r.status = 'pending')
       when 'group_request_approved' then community.group_member(n.group_id, n.profile_id)
       when 'group_role' then community.group_member(n.group_id, n.profile_id)
       when 'group_request_declined' then true
       when 'group_removed' then true
       when 'message' then exists (
            select 1 from community.conversations c
             where c.id = n.conversation_id and n.profile_id in (c.member_a, c.member_b))
            and not exists (select 1 from community.blocks b where b.blocker_id = n.profile_id and b.blocked_id = n.actor_id)
       when 'event' then exists (
            select 1 from events.occurrences o where o.id = n.occurrence_id and events.visible_to(o.series_id, n.profile_id))
       when 'prayer_comment' then exists (
            select 1 from prayer.requests r
             where r.id = n.prayer_request_id and r.status <> 'archived' and r.hidden_at is null and prayer.can_read(r, n.profile_id))
       when 'prayer_update' then exists (
            select 1 from prayer.requests r
             where r.id = n.prayer_request_id and r.status <> 'archived' and r.hidden_at is null and prayer.can_read(r, n.profile_id))
       when 'prayer_answered' then exists (
            select 1 from prayer.requests r
             where r.id = n.prayer_request_id and r.status <> 'archived' and r.hidden_at is null and prayer.can_read(r, n.profile_id))
       when 'prayer_moderation' then exists (
            select 1 from prayer.requests r where r.id = n.prayer_request_id and prayer.can_read(r, n.profile_id))
       when 'care_assigned' then exists (
            select 1 from prayer.care_requests c
             where c.id = n.care_request_id and c.status <> 'closed' and c.assigned_to = n.profile_id)
            and prayer.holds(n.profile_id, 'care.coordinate')
       when 'care_follow_up' then exists (
            select 1 from prayer.care_requests c
             where c.id = n.care_request_id and c.status <> 'closed' and c.assigned_to = n.profile_id)
            and prayer.holds(n.profile_id, 'care.coordinate')
       when 'care_response' then exists (
            select 1 from prayer.care_requests c
             where c.id = n.care_request_id
               and (c.requester_id = n.profile_id
                    or (c.assigned_to = n.profile_id and prayer.holds(n.profile_id, 'care.coordinate'))))
       when 'care_volunteer' then exists (
            select 1 from prayer.care_signups s
              join prayer.care_opportunities o on o.id = s.opportunity_id
             where s.opportunity_id = n.care_opportunity_id and s.profile_id = n.profile_id
               and s.status in ('accepted', 'completed') and o.status in ('open', 'filled', 'completed'))
       when 'content_new' then media.item_visible_id(n.media_item_id, n.profile_id)
       when 'gallery_new' then exists (
            select 1 from media.albums a where a.id = n.media_album_id and media.album_visible(a, n.profile_id))
       when 'gallery_outcome' then exists (
            select 1 from media.albums a where a.id = n.media_album_id and media.can_contribute(a, n.profile_id))
       -- Reading reminders: the enrollment is still active with reminders on,
       -- and the member can still see the plan.
       when 'reading_reminder' then exists (
            select 1 from bible.enrollments e join bible.plans p on p.id = e.plan_id
             where e.id = n.bible_enrollment_id and e.profile_id = n.profile_id and e.status = 'active'
               and e.reminders and not e.reminders_paused and bible.plan_visible(p, n.profile_id))
       when 'reading_plan_changed' then exists (
            select 1 from bible.enrollments e join bible.plans p on p.id = e.plan_id
             where e.plan_id = n.bible_plan_id and e.profile_id = n.profile_id and e.status = 'active'
               and bible.plan_visible(p, n.profile_id))
       -- Memory verses: the member still wants this kind of reminder, and
       -- what it points to is still theirs to see.
       when 'memory_weekly_verse' then (select s.remind_weekly from memory.settings_of(n.profile_id) s)
            and exists (select 1 from memory.items i join memory.collections c on c.id = i.collection_id
                         where i.id = n.memory_item_id and i.retired_at is null and memory.collection_visible(c, n.profile_id))
       when 'memory_review_due' then (select s.remind_review and not s.paused from memory.settings_of(n.profile_id) s)
       when 'memory_practice_reminder' then (select s.remind_practice and not s.paused from memory.settings_of(n.profile_id) s)
       when 'memory_challenge_milestone' then exists (
            select 1 from memory.challenge_participants cp join memory.challenges ch on ch.id = cp.challenge_id
             where cp.challenge_id = n.memory_challenge_id and cp.profile_id = n.profile_id and cp.left_at is null
               and cp.sharing and community.group_member(ch.group_id, n.profile_id))
       -- Youth & Families: the recipient must still be a verified guardian
       -- with the matching permission (or a reviewer still in scope), and
       -- what it points to must still apply.
       when 'youth_announcement' then exists (
            select 1 from youth.announcements a where a.id = n.youth_announcement_id and youth.announcement_visible(a, n.profile_id))
       when 'youth_family' then n.youth_child_id is null or youth.guardian_can(n.youth_child_id, n.profile_id)
       when 'youth_registration' then youth.guardian_can(n.youth_child_id, n.profile_id, 'register')
            or youth.guardian_can(n.youth_child_id, n.profile_id, 'receive_updates')
       when 'youth_event_reminder' then (youth.guardian_can(n.youth_child_id, n.profile_id, 'register')
                                         or youth.guardian_can(n.youth_child_id, n.profile_id, 'receive_updates'))
            and exists (select 1 from youth.registrations r where r.occurrence_id = n.occurrence_id and r.child_id = n.youth_child_id
                           and r.status = 'confirmed')
       when 'youth_form_needed' then youth.guardian_can(n.youth_child_id, n.profile_id, 'sign_forms')
            and exists (select 1 from youth.event_forms ef where ef.series_id = n.youth_series_id
                           and youth.consent_state(ef.series_id, n.youth_child_id, ef.form_id) <> 'granted')
            and exists (select 1 from youth.registrations r join events.occurrences o on o.id = r.occurrence_id
                         where o.series_id = n.youth_series_id and r.child_id = n.youth_child_id and r.status <> 'canceled' and o.ends_at > now())
       when 'youth_consent_changed' then youth.guardian_can(n.youth_child_id, n.profile_id)
       when 'youth_learning' then exists (
            select 1 from youth.learning l where l.id = n.youth_learning_id and l.status = 'active'
               and (youth.guardian_in_group(l.group_id, n.profile_id, 'practice') or youth.guardian_in_group(l.group_id, n.profile_id, 'receive_updates')))
       when 'youth_report' then exists (
            select 1 from youth.reports r where r.id = n.youth_report_id and r.status = 'open' and youth.can_review(r, n.profile_id))
       -- Mentions: still mentioned there (not edited out), the post or
       -- comment is visible, the member can still read the post, and
       -- hasn't blocked the author.
       when 'mention' then community.mention_reaches(coalesce(n.post_id, n.thread_id), n.profile_id)
            and community.can_read_thread(n.thread_id, n.profile_id)
            and exists (select 1 from community.threads t where t.id = n.thread_id and t.status = 'visible')
            and (n.post_id is null or exists (select 1 from community.posts p where p.id = n.post_id and p.status = 'visible'))
            and not exists (select 1 from community.blocks b where b.blocker_id = n.profile_id and b.blocked_id = n.actor_id)
       -- Group mentions: the same, and (through mention_reaches) the member
       -- is still in a group that is still mentioned there.
       when 'group_mention' then community.mention_reaches(coalesce(n.post_id, n.thread_id), n.profile_id)
            and community.can_read_thread(n.thread_id, n.profile_id)
            and exists (select 1 from community.threads t where t.id = n.thread_id and t.status = 'visible')
            and (n.post_id is null or exists (select 1 from community.posts p where p.id = n.post_id and p.status = 'visible'))
            and not exists (select 1 from community.blocks b where b.blocker_id = n.profile_id and b.blocked_id = n.actor_id)
       when 'prayer_mention' then prayer.mention_notice_visible(n)
       when 'prayer_group_mention' then prayer.mention_notice_visible(n)
       else true
     end;
$$;

create or replace function community.notification_json(n community.notifications)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_url text := '/notifications';
  v_thread record;
  v_group_name text;
  v_actor text := case when n.actor_id is null then null else community.display_name(n.actor_id) end;
  v_others text := case when n.count > 1 then ' and others' else '' end;
  v_place text;
  v_prayer text;
  v_media record;
  v_album text;
  v_plan text;
  v_memory text;
  v_child text;
  v_event text;
begin
  if n.group_id is not null and community.can_see_group(n.group_id, n.profile_id) then
    select name into v_group_name from community.groups where id = n.group_id;
  end if;
  if n.thread_id is not null then
    select t.title, t.status, t.group_id, g.name as group_name
      into v_thread
      from community.threads t left join community.groups g on g.id = t.group_id
     where t.id = n.thread_id;
    v_place := case when v_thread.status = 'deleted' then 'a discussion'
                    else '“' || v_thread.title || '”' end;
    v_url := '/community/t/' || n.thread_id;
  end if;
  -- In the app only, and only after notification_visible: the reader can
  -- open this request now, so its title may be shown here.
  if n.prayer_request_id is not null then
    select '“' || r.title || '”' into v_prayer from prayer.requests r
     where r.id = n.prayer_request_id and prayer.can_read(r, n.profile_id);
    v_url := '/prayer/' || n.prayer_request_id;
  end if;
  -- Teaching and gallery: titles only after the visibility recheck.
  if n.media_item_id is not null then
    select i.id, i.kind, i.title into v_media from media.items i
     where i.id = n.media_item_id and media.item_visible(i, n.profile_id);
  end if;
  if n.media_album_id is not null then
    select a.title into v_album from media.albums a
     where a.id = n.media_album_id and (media.album_visible(a, n.profile_id) or media.can_contribute(a, n.profile_id));
  end if;
  -- Reading: the plan title only after the visibility recheck.
  if n.bible_plan_id is not null or n.bible_enrollment_id is not null then
    select p.title into v_plan from bible.plans p
     where p.id = coalesce(n.bible_plan_id, (select e.plan_id from bible.enrollments e where e.id = n.bible_enrollment_id))
       and bible.plan_visible(p, n.profile_id);
  end if;
  -- Memory: a verse reference or challenge title only after the recheck.
  if n.memory_item_id is not null then
    select p.label into v_memory from memory.items i join memory.passages p on p.id = i.passage_id
      join memory.collections c on c.id = i.collection_id
     where i.id = n.memory_item_id and memory.collection_visible(c, n.profile_id);
  elsif n.memory_challenge_id is not null then
    select ch.title into v_memory from memory.challenges ch
     where ch.id = n.memory_challenge_id and community.group_member(ch.group_id, n.profile_id);
  end if;
  -- Youth: the child's preferred name and the event title only after the
  -- recheck above (in the app; email and push stay generic).
  if n.youth_child_id is not null then
    select c.display_name into v_child from youth.children c where c.id = n.youth_child_id;
  end if;
  if n.category = 'youth' and (n.occurrence_id is not null or n.youth_series_id is not null) then
    select s.title into v_event from events.series s
     where s.id = coalesce(n.youth_series_id, (select o.series_id from events.occurrences o where o.id = n.occurrence_id));
  end if;
  case n.kind
    when 'reply_followed' then
      v_title := case when n.count > 1 then n.count || ' new replies in ' else coalesce(v_actor, 'Someone') || ' replied in ' end || v_place;
    when 'reply_mine' then
      v_title := case when n.count > 1 then n.count || ' new replies to your discussion ' else coalesce(v_actor, 'Someone') || ' replied to your discussion ' end || v_place;
    when 'group_invitation' then
      v_title := 'You''re invited to join ' || coalesce(v_group_name, 'a group');
      v_url := '/groups/invitations';
    when 'group_request' then
      v_title := case when n.count > 1 then n.count || ' new requests to join ' else coalesce(v_actor, 'Someone') || v_others || ' asked to join ' end
                 || coalesce(v_group_name, 'your group');
      v_url := '/groups/' || n.group_id || '/manage';
    when 'group_request_approved' then
      v_title := 'Welcome! Your request to join ' || coalesce(v_group_name, 'the group') || ' was approved';
      v_url := '/groups/' || n.group_id;
    when 'group_request_declined' then
      v_title := 'Your request to join ' || coalesce(v_group_name, 'a group') || ' wasn''t approved';
      v_url := '/groups';
    when 'group_removed' then
      v_title := 'You''re no longer a member of ' || coalesce(v_group_name, 'a group');
      v_url := '/groups';
    when 'group_role' then
      v_title := case when n.detail ->> 'role' = 'leader' then 'You''re now a leader of ' else 'Your role changed in ' end
                 || coalesce(v_group_name, 'a group');
      v_url := '/groups/' || n.group_id;
    when 'message' then
      v_title := case when n.count > 1 then 'You have ' || n.count || ' new messages' else 'You have a new message' end;
      v_url := '/messages/' || n.conversation_id;
    when 'event' then
      v_title := coalesce((select case n.detail ->> 'change'
                                    when 'promoted' then 'A place opened up and you''re registered: '
                                    when 'changed' then 'Event updated: '
                                    else 'Event canceled: ' end || s.title
                             from events.occurrences o join events.series s on s.id = o.series_id
                            where o.id = n.occurrence_id), 'An event changed');
      v_url := '/events/' || n.occurrence_id;
    when 'prayer_comment' then
      v_title := case when n.count > 1 then n.count || ' new comments on ' else 'A new comment on ' end
                 || case when n.detail ->> 'mine' = 'true' then 'your prayer request ' else 'a prayer request you follow: ' end
                 || coalesce(v_prayer, '');
    when 'prayer_update' then
      v_title := 'An update on a prayer request you follow: ' || coalesce(v_prayer, '');
    when 'prayer_answered' then
      v_title := 'A prayer was answered: ' || coalesce(v_prayer, '');
    when 'prayer_moderation' then
      v_title := case n.detail ->> 'action'
                   when 'hidden' then 'A moderator hid ' || case when n.detail ->> 'target' = 'comment' then 'your comment on ' else 'your prayer request ' end
                   when 'restored' then 'A moderator restored ' || case when n.detail ->> 'target' = 'comment' then 'your comment on ' else 'your prayer request ' end
                   when 'locked' then 'A moderator turned off comments on your prayer request '
                   when 'unlocked' then 'A moderator turned comments back on for your prayer request '
                   else 'A moderator update about ' end || coalesce(v_prayer, 'a prayer request');
    when 'care_assigned' then
      v_title := 'You were assigned a care request';
      v_url := '/prayer/team/care/' || n.care_request_id;
    when 'care_follow_up' then
      v_title := 'A care request you coordinate is due for follow-up';
      v_url := '/prayer/team/care/' || n.care_request_id;
    when 'care_response' then
      if n.detail ->> 'to' = 'team' then
        v_title := case when n.count > 1 then n.count || ' new replies on a care request you coordinate' else 'New reply on a care request you coordinate' end;
        v_url := '/prayer/team/care/' || n.care_request_id;
      else
        v_title := case when n.detail ? 'status' then 'Your care request was updated' else 'The care team responded to your request' end;
        v_url := '/prayer/care/' || n.care_request_id;
      end if;
    when 'care_volunteer' then
      v_title := 'You''re confirmed to help: ' || coalesce((select '“' || o.title || '”' from prayer.care_opportunities o where o.id = n.care_opportunity_id), 'a care opportunity');
      v_url := '/prayer/serve/' || n.care_opportunity_id;
    when 'content_new' then
      v_title := case n.detail ->> 'kind'
                   when 'devotional' then 'New devotional: '
                   when 'lesson' then 'New Sunday lesson: '
                   when 'episode' then 'New podcast episode: '
                   when 'assignment' then 'New reading assignment: '
                   when 'playlist' then 'New playlist: '
                   else 'New in the teaching library: ' end || coalesce('“' || v_media.title || '”', '');
      v_url := case n.detail ->> 'kind'
                 when 'devotional' then '/devotionals/'
                 when 'lesson' then '/lessons/'
                 when 'episode' then '/podcasts/episodes/'
                 when 'assignment' then '/reading/assignments/'
                 when 'playlist' then '/music/'
                 else '/media/items/' end || n.media_item_id;
    when 'gallery_new' then
      v_title := 'New photos in ' || coalesce('“' || v_album || '”', 'an album');
      v_url := '/gallery/' || n.media_album_id;
    when 'gallery_outcome' then
      v_title := case when n.count > 1 then 'Updates about ' || n.count || ' photos you shared' else
                   case n.detail ->> 'action'
                     when 'approve' then 'Your photo was approved'
                     when 'reject' then 'Your photo wasn''t approved'
                     when 'hide' then 'A moderator hid your photo'
                     when 'unhide' then 'Your photo is visible again'
                     when 'remove' then 'A moderator removed your photo'
                     else 'An update about your photo' end end
                 || coalesce(' in “' || v_album || '”', '');
      v_url := '/gallery/mine';
    when 'reading_reminder' then
      v_title := 'Today''s reading is ready' || coalesce(': “' || v_plan || '”', '');
      v_url := '/bible/today';
    when 'reading_plan_changed' then
      v_title := 'Upcoming readings changed in ' || coalesce('“' || v_plan || '”', 'a reading plan you follow');
      v_url := coalesce('/bible/plans/' || coalesce(n.bible_plan_id, (select e.plan_id from bible.enrollments e where e.id = n.bible_enrollment_id)), '/bible');
    when 'memory_weekly_verse' then
      v_title := case when n.count > 1 or (n.detail ->> 'count')::integer > 1 then 'New memory verses are ready' else 'A new memory verse is ready' end
                 || coalesce(': ' || v_memory, '');
      v_url := '/memory/assignment';
    when 'memory_review_due' then
      v_title := 'Some of your memory verses are ready to review';
      v_url := '/memory/review';
    when 'memory_practice_reminder' then
      v_title := 'A few minutes with your memory verses?';
      v_url := '/memory';
    when 'memory_challenge_milestone' then
      v_title := 'Your group reached ' || coalesce(n.detail ->> 'percent', 'a milestone') || '% of its goal'
                 || coalesce(' in “' || v_memory || '”', '');
      v_url := '/memory/challenges/' || n.memory_challenge_id;
    when 'youth_announcement' then
      v_title := 'Youth announcement: ' || coalesce((select '“' || a.title || '”' from youth.announcements a where a.id = n.youth_announcement_id), '');
      v_url := '/youth/announcements';
    when 'youth_family' then
      v_title := case n.detail ->> 'event'
                   when 'account_activated' then coalesce(v_child, 'Your child') || ' activated their own youth account'
                   else 'Your Youth & Families request was reviewed' end;
      v_url := case when n.youth_child_id is not null then '/youth/family/children/' || n.youth_child_id else '/youth/family' end;
    when 'youth_registration' then
      v_title := case n.detail ->> 'change'
                   when 'promoted' then 'A place opened up and ' || coalesce(v_child, 'your child') || ' is registered'
                   when 'event_canceled' then 'Canceled for ' || coalesce(v_child, 'your child')
                   else 'Registration update for ' || coalesce(v_child, 'your child') end || coalesce(': ' || v_event, '');
      v_url := '/youth/family/children/' || n.youth_child_id || coalesce('/events/' || n.occurrence_id, '');
    when 'youth_event_reminder' then
      v_title := 'Coming up for ' || coalesce(v_child, 'your child') || coalesce(': ' || v_event, '');
      v_url := '/youth/family/children/' || n.youth_child_id || coalesce('/events/' || n.occurrence_id, '');
    when 'youth_form_needed' then
      v_title := 'A permission form needs your review for ' || coalesce(v_child, 'your child') || coalesce(': ' || v_event, '');
      v_url := '/youth/family/children/' || n.youth_child_id;
    when 'youth_consent_changed' then
      v_title := 'A permission or photo consent decision changed for ' || coalesce(v_child, 'your child');
      v_url := '/youth/family/children/' || n.youth_child_id;
    when 'youth_learning' then
      v_title := 'New learning was assigned to ' || coalesce((select g.name from youth.learning l join youth.groups g on g.id = l.group_id
                                                              where l.id = n.youth_learning_id), 'a youth group');
      v_url := '/youth/family';
    when 'mention' then
      v_title := coalesce(v_actor, 'Someone') || ' mentioned you in '
                 || case when n.post_id is not null then 'a comment in ' else '' end
                 || coalesce(v_thread.group_name, 'Community');
    when 'group_mention' then
      v_title := coalesce(v_actor, 'Someone') || ' mentioned '
                 || coalesce('your group, ' || v_group_name || ',', 'your group') || ' in '
                 || case when n.post_id is not null then 'a comment in ' else '' end
                 || coalesce(v_thread.group_name, 'Community');
    -- Prayer mentions never name who wrote them (requests can be anonymous).
    when 'prayer_mention' then
      v_title := 'You were mentioned in '
                 || case when n.detail ? 'comment_id' and n.detail ->> 'comment_id' is not null then 'a comment on a prayer request' else 'a prayer request' end
                 || coalesce(': ' || v_prayer, '');
      v_url := '/prayer/' || n.prayer_request_id || coalesce('?comment=' || (n.detail ->> 'comment_id'), '');
    when 'prayer_group_mention' then
      v_title := coalesce('Your group, ' || v_group_name || ', was', 'Your group was') || ' mentioned in '
                 || case when n.detail ? 'comment_id' and n.detail ->> 'comment_id' is not null then 'a comment on a prayer request' else 'a prayer request' end
                 || coalesce(': ' || v_prayer, '');
      v_url := '/prayer/' || n.prayer_request_id || coalesce('?comment=' || (n.detail ->> 'comment_id'), '');
    when 'youth_report' then
      v_title := 'A youth discussion report needs review';
      v_url := '/youth/lead/reports';
    else
      v_title := case n.detail ->> 'action'
                   when 'hidden' then 'A moderator removed something you posted'
                   when 'restored' then 'A moderator restored something you posted'
                   when 'restricted' then 'Your community participation has been limited'
                   when 'restriction_lifted' then 'Your community participation has been restored'
                   when 'locked' then 'A discussion you started was locked'
                   when 'report_received' then case when n.count > 1 then n.count || ' new reports' else 'A new report' end
                                               || ' about a post in ' || coalesce(v_group_name, 'your group')
                   else 'A moderator update about your community activity' end;
      v_url := case when n.detail ->> 'action' in ('restricted', 'restriction_lifted') then '/community/guidelines'
                    when n.detail ->> 'action' = 'report_received' then '/groups/' || n.group_id || '/manage/reports'
                    when n.thread_id is not null then v_url else '/notifications' end;
  end case;
  return jsonb_build_object(
    'id', n.id, 'kind', n.kind, 'category', n.category, 'title', v_title, 'url', v_url,
    'count', n.count, 'created_at', n.updated_at, 'read', n.read_at is not null,
    'reason', case when n.kind in ('moderation', 'prayer_moderation') then n.detail ->> 'reason' end,
    'group_name', v_group_name);
end;
$$;

create or replace function community.notification_email_item(n community.notifications)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j jsonb;
  v_group text;
begin
  -- Prayer and care: never a title, body, care detail, or name.
  if n.category in ('prayer', 'care') or n.kind = 'prayer_moderation' then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind
                 when 'prayer_comment' then 'New activity on a prayer request'
                 when 'prayer_update' then 'An update on a prayer request you follow'
                 when 'prayer_answered' then 'An update on a prayer request you follow'
                 when 'prayer_moderation' then 'A moderator update about your prayer activity'
                 when 'care_assigned' then 'You have a new care assignment'
                 when 'care_follow_up' then 'A care follow-up is due'
                 when 'care_volunteer' then 'You''re confirmed as a care volunteer'
                 else 'An update about a care request' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Teaching and gallery: generic outside the app (content may be limited
  -- to members or a group, and album titles can be personal).
  if n.category in ('teaching', 'gallery') then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind
                 when 'content_new' then case n.detail ->> 'kind'
                                           when 'devotional' then 'A new devotional is available'
                                           when 'lesson' then 'A new Sunday lesson is available'
                                           when 'episode' then 'A new podcast episode is available'
                                           when 'assignment' then 'A new reading assignment is available'
                                           when 'playlist' then 'A new playlist is available'
                                           else 'Something new is in the teaching library' end
                 when 'gallery_new' then 'New photos were added to an album'
                 else 'An update about photos you shared' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Reading: generic outside the app (never a plan title, passage, or
  -- anything from the member's journal).
  if n.category = 'reading' then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind when 'reading_reminder' then 'Your Bible reading for today is ready'
                           else 'A reading plan you follow was updated' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Memory: generic outside the app (never a verse, a count of verses,
  -- accuracy, or practice history).
  if n.category = 'memory' then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind when 'memory_weekly_verse' then 'A new memory verse is ready'
                           when 'memory_review_due' then 'You have memory verses ready to review'
                           when 'memory_practice_reminder' then 'A reminder to practice your memory verses'
                           else 'Your group memory challenge reached a milestone' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Youth & Families: always generic outside the app (never a child's
  -- name, an event, a group, contact details, or form text).
  if n.category = 'youth' then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind when 'youth_report' then 'A youth discussion report needs review'
                           else 'There''s an update in Youth & Families' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Prayer mentions: always generic (never the request, a name, or a group).
  if n.kind in ('prayer_mention', 'prayer_group_mention') then
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case n.kind when 'prayer_mention' then 'You were mentioned in ' else 'Your group was mentioned in ' end
               || case when n.detail ->> 'comment_id' is not null then 'a comment on a prayer request' else 'a prayer request' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Group mentions: like person mentions below, but in a group discussion
  -- only the discussion's group is named.
  if n.kind = 'group_mention' then
    select g.name into v_group from community.threads t join community.groups g on g.id = t.group_id where t.id = n.thread_id;
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case when v_group is not null then 'Your group was mentioned in a ' || v_group || ' group discussion'
                    else community.notification_json(n) ->> 'title' end,
      'url', '/notifications/open/' || n.id);
  end if;
  -- Mentions: church-wide ones name who mentioned you (like replies);
  -- group ones name only the group.
  if n.kind = 'mention' then
    select g.name into v_group from community.threads t join community.groups g on g.id = t.group_id where t.id = n.thread_id;
    return jsonb_build_object('kind', n.kind, 'category', n.category,
      'title', case when v_group is not null then 'You were mentioned in a ' || v_group || ' group discussion'
                    else community.notification_json(n) ->> 'title' end,
      'url', '/notifications/open/' || n.id);
  end if;
  j := community.notification_json(n);
  if n.thread_id is not null then
    select g.name into v_group from community.threads t join community.groups g on g.id = t.group_id where t.id = n.thread_id;
    if v_group is not null then
      j := jsonb_set(j, '{title}', to_jsonb(
        case when n.count > 1 then n.count || ' new replies' else 'A new reply' end
        || ' in a ' || v_group || ' group discussion'));
    end if;
  end if;
  return jsonb_build_object('kind', n.kind, 'category', n.category, 'title', j ->> 'title', 'url', j ->> 'url');
end;
$$;

create or replace function community.op_push_claim(v jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce((v ->> 'limit')::integer, 20), 1), 50);
  r record;
  n community.notifications;
  v_out jsonb := '[]'::jsonb;
  v_subs jsonb;
begin
  for r in
    select p.* from community.push_outbox p
     where p.next_attempt_at <= now() and p.send_after <= now()
       and (p.status = 'pending' or (p.status = 'failed' and p.attempts < 3)
            or (p.status = 'sending' and p.updated_at < now() - interval '10 minutes'))
     order by p.created_at
     limit v_limit
     for update skip locked
  loop
    select * into n from community.notifications where id = r.notification_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      into v_subs from community.push_subscriptions s where s.profile_id = r.profile_id;
    if n.id is null or n.read_at is not null or not community.notification_visible(n)
       or not (select x.push from community.pref(n.profile_id, n.category) x)
       or jsonb_array_length(v_subs) = 0 then
      update community.push_outbox set status = 'skipped', attempts = attempts + 1, updated_at = now() where id = r.id;
      continue;
    end if;
    update community.push_outbox set status = 'sending', attempts = attempts + 1, updated_at = now() where id = r.id;
    -- Generic text only: never titles, names, or message content.
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'dedupe_key', r.dedupe_key, 'subscriptions', v_subs,
      'body', case when n.kind = 'prayer_mention' then 'You were mentioned in a prayer request.'
                   when n.kind = 'prayer_group_mention' then 'Your group was mentioned in a prayer request.'
                   when n.kind = 'group_mention' then 'Your group was mentioned in Community.'
                   else case n.category
                when 'messages' then 'You have a new message.'
                when 'forum' then 'There''s new activity in a discussion.'
                when 'groups' then 'There''s an update about your groups.'
                when 'events' then 'There''s an update about an event.'
                when 'prayer' then 'There''s new activity on a prayer request.'
                when 'care' then 'There''s an update about care.'
                when 'teaching' then 'There''s something new in the teaching library.'
                when 'gallery' then 'There''s an update in the photo gallery.'
                when 'reading' then 'There''s an update about your Bible reading.'
                when 'memory' then 'There''s an update about your memory verses.'
                when 'youth' then 'There''s an update in Youth & Families.'
                when 'mentions' then 'Someone mentioned you in Community.'
                else 'You have a new notification.' end end,
      'url', '/notifications/open/' || n.id));
  end loop;
  return v_out;
end;
$$;

create or replace function public.community_my_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  s community.member_settings;
begin
  select * into s from community.member_settings where profile_id = v_uid;
  return jsonb_build_object(
    'prefs', (select jsonb_object_agg(c, jsonb_build_object('in_app', x.in_app, 'email', x.email, 'push', x.push))
                from unnest(array['forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions', 'group_mentions']) c
                cross join lateral community.pref(v_uid, c) x),
    'timezone', s.timezone,
    'effective_timezone', community.member_tz(v_uid),
    'quiet_enabled', coalesce(s.quiet_enabled, false),
    'quiet_start', to_char(coalesce(s.quiet_start, '21:00'::time), 'HH24:MI'),
    'quiet_end', to_char(coalesce(s.quiet_end, '07:00'::time), 'HH24:MI'),
    'dm_allow', coalesce((select allow from community.dm_prefs where profile_id = v_uid), 'members'),
    'dm_eligible', community.dm_eligible(v_uid),
    'guidelines_acked', community.has_acked(v_uid),
    'posting_restricted', community.restricted(v_uid, 'posting'),
    'messaging_restricted', community.restricted(v_uid, 'messaging'),
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'created_at', created_at,
                                                                  'last_success_at', last_success_at) order by created_at)
                                from community.push_subscriptions where profile_id = v_uid), '[]'::jsonb),
    'mutes', coalesce((select jsonb_agg(jsonb_build_object('type', m.target_type, 'id', m.target_id,
                         'label', case m.target_type
                                    when 'thread' then (select case when t.status = 'visible' and community.can_read_thread(t.id, v_uid) then t.title end
                                                          from community.threads t where t.id = m.target_id)
                                    when 'group' then (select g.name from community.groups g
                                                        where g.id = m.target_id and community.can_see_group(g.id, v_uid))
                                    else 'A conversation' end) order by m.created_at)
                         from community.mutes m where m.profile_id = v_uid), '[]'::jsonb));
end;
$$;

create or replace function public.community_notification_panel(
  p_categories text[] default null,
  p_unread boolean default false,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 15), 1), 30);
  v_items jsonb;
  v_more boolean;
begin
  if p_categories is not null and not (p_categories <@ array['forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care',
                                                             'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions', 'group_mentions']) then
    raise exception 'Unknown notification category.' using errcode = '22023';
  end if;
  if p_before_id is not null and p_before is null then
    raise exception 'A page cursor needs its time.' using errcode = '22023';
  end if;
  -- One extra row tells whether there's another page.
  select coalesce(jsonb_agg(community.notification_json(x) order by x.updated_at desc, x.id desc), '[]'::jsonb)
    into v_items
    from (select n.* from community.notifications n
           where n.profile_id = v_uid
             and n.dismissed_at is null
             and (p_before is null
                  or (p_before_id is null and n.updated_at < p_before)
                  or (p_before_id is not null and (n.updated_at, n.id) < (p_before, p_before_id)))
             and (p_categories is null or n.category = any (p_categories))
             and (not coalesce(p_unread, false) or (n.read_at is null and n.kind <> 'message'))
             and community.notification_visible(n)
           order by n.updated_at desc, n.id desc
           limit v_limit + 1) x;
  v_more := jsonb_array_length(v_items) > v_limit;
  if v_more then
    v_items := v_items - v_limit;
  end if;
  return jsonb_build_object(
    'items', v_items,
    'has_more', v_more,
    'timezone', community.member_tz(v_uid),
    'has_read', exists (select 1 from community.notifications n
                         where n.profile_id = v_uid and n.read_at is not null and n.dismissed_at is null
                           and community.notification_visible(n)));
end;
$$;

create or replace function public.community_set_pref(p_category text, p_in_app boolean, p_email text, p_push boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := community.require_member();
begin
  if p_category not in ('forum', 'groups', 'messages', 'moderation', 'events', 'prayer', 'care', 'teaching', 'gallery', 'reading', 'memory', 'youth', 'mentions', 'group_mentions') then
    raise exception 'Unknown notification category.' using errcode = '22023';
  end if;
  if p_email not in ('off', 'immediate', 'daily', 'weekly')
     or (p_category in ('messages', 'care', 'reading', 'memory', 'youth', 'mentions', 'group_mentions') and p_email not in ('off', 'immediate'))
     or (p_category = 'events' and p_email <> 'off') then
    raise exception 'Choose a valid email option.' using errcode = '22023';
  end if;
  insert into community.notification_prefs (profile_id, category, in_app, email, push)
  values (v_uid, p_category, coalesce(p_in_app, true) or p_category = 'moderation', p_email, coalesce(p_push, false))
  on conflict (profile_id, category) do update
    set in_app = excluded.in_app, email = excluded.email, push = excluded.push, updated_at = now();
  -- Queued email for a category that is now off is dropped.
  if p_email = 'off' then
    update community.email_outbox e set status = 'skipped', updated_at = now()
     where e.profile_id = v_uid and e.status in ('pending', 'failed') and e.kind = 'immediate'
       and exists (select 1 from community.notifications n where n.id = e.notification_id and n.category = p_category);
  end if;
end;
$$;

create or replace function community.thread_card(t community.threads, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'title', case when t.status = 'visible' then t.title end,
    'excerpt', case when t.status = 'visible' then left(regexp_replace(community.mention_plain(community.mention_redact(t.body, p_viewer)), '\s+', ' ', 'g'), 180) end,
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

create or replace function community.feed_card(t community.threads, p_viewer uuid, p_mod boolean, p_can_post boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select community.thread_card(t, p_viewer) || jsonb_build_object(
    'title', case when t.status = 'visible' or (t.status = 'hidden' and p_mod) then t.title end,
    'body', case when t.status = 'visible' or (t.status = 'hidden' and p_mod) then community.mention_redact(t.body, p_viewer) end,
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
    'mentions', case when t.status = 'visible' or (t.status = 'hidden' and p_mod) then community.mentions_all_json(t.id, null, p_viewer) end,
    'can_moderate', p_mod,
    'can_reply', p_can_post and t.status = 'visible' and not t.locked
                 and coalesce((select g.status::text = 'active' from community.groups g where g.id = t.group_id), true),
    'muted', exists (select 1 from community.mutes m where m.profile_id = p_viewer and m.target_type = 'thread' and m.target_id = t.id));
$$;

create or replace function community.post_json(p community.posts, p_viewer uuid, p_can_moderate boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'status', p.status,
    'body', case when p.status = 'visible' or (p.status = 'hidden' and p_can_moderate) then community.mention_redact(p.body, p_viewer) end,
    'author', case when p.status <> 'deleted' and p.author_id is not null then community.display_name(p.author_id) end,
    'author_id', case when p.status <> 'deleted' then p.author_id end,
    'mine', p.author_id = p_viewer,
    'created_at', p.created_at, 'edited_at', p.edited_at,
    'reactions', case when p.status = 'visible' then community.reactions_json('post', p.id, p_viewer) end);
$$;

create or replace function community.comment_json(p community.posts, p_viewer uuid, p_mod boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select community.post_json(p, p_viewer, p_mod) || jsonb_build_object(
    'mentions', case when p.status = 'visible' or (p.status = 'hidden' and p_mod) then community.mentions_all_json(p.thread_id, p.id, p_viewer) end,
    'attachments', coalesce((select jsonb_agg(community.attachment_json(a) order by a.sort_order, a.created_at)
                               from community.attachments a
                              where a.post_id = p.id and a.target_type = 'post' and a.status = 'attached'
                                and community.attachment_visible(a)), '[]'::jsonb));
$$;

create or replace function prayer.card(r prayer.requests, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'excerpt', left(regexp_replace(community.mention_plain(community.mention_redact(r.body, p_viewer)), '\s+', ' ', 'g'), 160),
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

create or replace function prayer.comment_json(c prayer.comments, r prayer.requests, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'body', case when c.status = 'visible' then community.mention_redact(c.body, p_viewer) end,
    'mentions', case when c.status = 'visible' then prayer.mentions_json(c.id, p_viewer) end,
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

create or replace function public.prayer_request(p_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
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
    'body', community.mention_redact(r.body, v_uid),
    'mentions', prayer.mentions_json(r.id, v_uid),
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

-- ---------------------------------------------------------------------------
-- Grants: private helpers stay private; the new member functions are for
-- signed-in members only (each rechecks membership and access).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema community from public, anon, authenticated, service_role;
revoke execute on all functions in schema prayer from public, anon, authenticated, service_role;

revoke execute on function public.community_mention_suggest(text, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.community_mention_suggest(text, uuid, uuid, uuid) to authenticated;
revoke execute on function public.prayer_mention_suggest(text, uuid, text, uuid, boolean) from public, anon, service_role;
grant execute on function public.prayer_mention_suggest(text, uuid, text, uuid, boolean) to authenticated;
revoke execute on function public.prayer_mention_check(text, uuid, boolean, uuid[], uuid[]) from public, anon, service_role;
grant execute on function public.prayer_mention_check(text, uuid, boolean, uuid[], uuid[]) to authenticated;
revoke execute on function public.prayer_comment_position(uuid, uuid) from public, anon, service_role;
grant execute on function public.prayer_comment_position(uuid, uuid) to authenticated;
revoke execute on function public.community_group_set_mention_notify(uuid, text) from public, anon, service_role;
grant execute on function public.community_group_set_mention_notify(uuid, text) to authenticated;
