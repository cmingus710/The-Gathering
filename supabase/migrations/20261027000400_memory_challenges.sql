-- Phase 9 · Optional group memory challenges (adults only, on the Phase 5
-- group permissions).
--
-- Privacy rules:
--   * Joining is explicit, after reading what participation shares. Nobody
--     is enrolled by a leader, a household, or a collection.
--   * Only the shared total is ever shown: practice activities completed on
--     the challenge's verses, by people who are sharing, since they joined,
--     within the dates. Never a name, a person's count, accuracy, hints,
--     confidence, missed days, or a ranking.
--   * Totals stay hidden until at least min_participants (3–50, default 5)
--     people are sharing; the number sharing is hidden too until then.
--   * Totals are rounded down to a multiple of 5 and count through the end
--     of the previous day (church time zone; the last day counts once the
--     challenge ends), which makes it hard to work out one person's
--     activity from a change in the total.
--   * Leaving or revoking sharing removes that person's contributions from
--     every total immediately (totals are computed live, never stored per
--     person). Deleting practice history removes them as well. Milestones
--     already announced aren't announced again.
--   * Group membership is rechecked on every read; leaving the group or
--     suspension ends participation (memory.reconcile_access).
-- Phase 10 will add guardian-approved family challenges; nothing here
-- reaches youth accounts (community.group_member requires an adult account).

create function memory.challenge_today(ch memory.challenges)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select memory.local_today(memory.church_tz());
$$;

create function memory.challenge_aggregate(ch memory.challenges)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := memory.challenge_today(ch);
  v_through date := least(ch.ends_on, case when v_today > ch.ends_on then ch.ends_on else v_today - 1 end);
  v_sharing integer;
  v_sessions integer;
  v_refs text[];
  v_translation uuid;
begin
  select count(*) into v_sharing from memory.challenge_participants cp
   where cp.challenge_id = ch.id and cp.left_at is null and cp.sharing
     and community.group_member(ch.group_id, cp.profile_id);
  if v_sharing < ch.min_participants then
    return jsonb_build_object('visible', false, 'min_participants', ch.min_participants, 'goal', ch.goal_sessions);
  end if;
  select c.translation_id into v_translation from memory.collections c where c.id = ch.collection_id;
  select array_agg(distinct p.ref_key) into v_refs
    from memory.items i join memory.passages p on p.id = i.passage_id
   where i.collection_id = ch.collection_id and i.retired_at is null;
  select count(*) into v_sessions
    from memory.attempts a
    join memory.passages p on p.id = a.passage_id
    join memory.challenge_participants cp on cp.challenge_id = ch.id and cp.profile_id = a.profile_id
   where cp.left_at is null and cp.sharing and community.group_member(ch.group_id, cp.profile_id)
     and a.completed and a.created_at >= cp.joined_at
     and a.local_date between ch.starts_on and v_through
     and p.translation_id = v_translation and p.ref_key = any(coalesce(v_refs, '{}'));
  v_sessions := (v_sessions / 5) * 5;
  return jsonb_build_object('visible', true, 'participants', v_sharing, 'sessions', v_sessions, 'goal', ch.goal_sessions,
                            'percent', least(100, floor(100.0 * v_sessions / ch.goal_sessions))::integer,
                            'through', case when v_through >= ch.starts_on then v_through end,
                            'min_participants', ch.min_participants);
end;
$$;

create function memory.challenge_json(ch memory.challenges, p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', ch.id, 'title', ch.title, 'description', ch.description, 'starts_on', ch.starts_on, 'ends_on', ch.ends_on,
    'goal_sessions', ch.goal_sessions, 'min_participants', ch.min_participants, 'status', ch.status,
    'group', (select jsonb_build_object('id', g.id, 'name', g.name) from community.groups g where g.id = ch.group_id),
    'collection', (select jsonb_build_object('id', c.id, 'title', c.title,
                                             'visible', memory.collection_visible(c, p_profile)) from memory.collections c where c.id = ch.collection_id),
    'me', (select jsonb_build_object('joined', cp.left_at is null, 'sharing', cp.sharing and cp.left_at is null, 'joined_at', cp.joined_at,
                                     'left_at', cp.left_at)
             from memory.challenge_participants cp where cp.challenge_id = ch.id and cp.profile_id = p_profile),
    'aggregate', memory.challenge_aggregate(ch));
$$;

create function memory.load_challenge(p_id uuid, p_uid uuid)
returns memory.challenges
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ch memory.challenges;
begin
  select * into ch from memory.challenges where id = p_id;
  if ch.id is null or not community.group_member(ch.group_id, p_uid) then
    raise exception 'Challenge not found.' using errcode = 'P0002';
  end if;
  return ch;
end;
$$;

create function memory.can_run_challenges(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select memory.is_member((select auth.uid()))
     and (public.has_capability('memory.publish') or memory.leader_authorized(p_group, (select auth.uid())));
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
create function public.memory_challenges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  return coalesce((select jsonb_agg(memory.challenge_json(ch, v_uid) order by ch.status <> 'active', ch.starts_on desc)
                     from memory.challenges ch
                    where community.group_member(ch.group_id, v_uid) and ch.status <> 'canceled'
                      and ch.ends_on >= memory.challenge_today(ch) - 60), '[]'::jsonb);
end;
$$;

create function public.memory_challenge(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  ch memory.challenges := memory.load_challenge(p_id, v_uid);
begin
  return memory.challenge_json(ch, v_uid) || jsonb_build_object('can_manage', memory.can_run_challenges(ch.group_id));
end;
$$;

-- p_understood: the member read what participation shares.
create function public.memory_challenge_join(p_id uuid, p_understood boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  ch memory.challenges := memory.load_challenge(p_id, v_uid);
begin
  perform community.rate_limit(v_uid, 'memory_challenge', 30, interval '10 minutes');
  if p_understood is not true then
    raise exception 'Please confirm you''ve read what joining shares.' using errcode = '22023';
  end if;
  if ch.status <> 'active' or memory.challenge_today(ch) > ch.ends_on then
    raise exception 'This challenge has ended.' using errcode = '22023';
  end if;
  insert into memory.challenge_participants (challenge_id, profile_id)
  values (ch.id, v_uid)
  on conflict (challenge_id, profile_id) do update
    set joined_at = case when memory.challenge_participants.left_at is null then memory.challenge_participants.joined_at else now() end,
        left_at = null, sharing = true, updated_at = now();
  return memory.challenge_json(ch, v_uid);
end;
$$;

-- Pause or resume sharing (still a participant; contributions while not
-- sharing are never counted).
create function public.memory_challenge_sharing(p_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  ch memory.challenges := memory.load_challenge(p_id, v_uid);
begin
  perform community.rate_limit(v_uid, 'memory_challenge', 30, interval '10 minutes');
  update memory.challenge_participants
     set sharing = coalesce(p_on, false),
         -- Resuming counts only from now, so paused time stays private.
         joined_at = case when p_on and not sharing then now() else joined_at end,
         updated_at = now()
   where challenge_id = ch.id and profile_id = v_uid and left_at is null;
  return memory.challenge_json(ch, v_uid);
end;
$$;

create function public.memory_challenge_leave(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- Leaving works even after losing access to the group.
  if v_uid is null then
    raise exception 'Only approved members can do that.' using errcode = '42501';
  end if;
  update memory.challenge_participants set left_at = coalesce(left_at, now()), sharing = false, updated_at = now()
   where challenge_id = p_id and profile_id = v_uid;
  delete from community.notifications n
   where n.profile_id = v_uid and n.kind = 'memory.challenge_milestone' and n.memory_challenge_id = p_id and n.read_at is null;
  return jsonb_build_object('left', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizers: memory.publish holders, or authorized leaders of the group
-- ---------------------------------------------------------------------------
create function public.memory_admin_challenges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  return coalesce((select jsonb_agg(memory.challenge_json(ch, v_uid) order by ch.status <> 'active', ch.starts_on desc)
                     from memory.challenges ch where memory.can_run_challenges(ch.group_id)), '[]'::jsonb);
end;
$$;

-- p: group_id, collection_id, title, description, starts_on, ends_on,
--    goal_sessions, min_participants. After creation only the title,
--    description, goal, and end date (later only) can change.
create function public.memory_admin_challenge_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  ch memory.challenges;
  c memory.collections;
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_start date := nullif(p ->> 'starts_on', '')::date;
  v_end date := nullif(p ->> 'ends_on', '')::date;
  v_goal integer := nullif(p ->> 'goal_sessions', '')::integer;
  v_min integer := coalesce(nullif(p ->> 'min_participants', '')::integer, 5);
  v_title text := btrim(coalesce(p ->> 'title', ''));
begin
  perform community.rate_limit(v_uid, 'memory_challenge', 30, interval '10 minutes');
  if char_length(v_title) not between 1 and 120 or char_length(coalesce(p ->> 'description', '')) > 2000 then
    raise exception 'Give the challenge a title (up to 120 characters).' using errcode = '22023';
  end if;
  if v_goal is null or v_goal not between 1 and 100000 then
    raise exception 'Set a shared goal of at least one practice activity.' using errcode = '22023';
  end if;
  if p_id is null then
    if not memory.can_run_challenges(v_group) then
      raise exception 'You do not have permission to do that.' using errcode = '42501';
    end if;
    if not exists (select 1 from community.groups g where g.id = v_group and g.status = 'active') then
      raise exception 'Choose an active group.' using errcode = '22023';
    end if;
    select * into c from memory.collections where id = nullif(p ->> 'collection_id', '')::uuid;
    if c.id is null or c.status <> 'published' or not (c.audience = 'members' or (c.audience = 'group' and c.group_id = v_group)) then
      raise exception 'Choose a published collection the group can see.' using errcode = '22023';
    end if;
    if v_start is null or v_end is null or v_end < v_start or v_end - v_start > 120 then
      raise exception 'Choose dates up to 120 days apart.' using errcode = '22023';
    end if;
    if v_end < memory.local_today(memory.church_tz()) then
      raise exception 'The challenge would already be over.' using errcode = '22023';
    end if;
    if v_min not between 3 and 50 then
      raise exception 'Totals need at least 3 people sharing (up to 50).' using errcode = '22023';
    end if;
    insert into memory.challenges (group_id, collection_id, title, description, starts_on, ends_on, goal_sessions, min_participants, created_by)
    values (v_group, c.id, v_title, coalesce(p ->> 'description', ''), v_start, v_end, v_goal, v_min, v_uid)
    returning * into ch;
    perform memory.audit('memory.challenge_created', 'memory_challenge', ch.id, jsonb_build_object('group', v_group));
    return memory.challenge_json(ch, v_uid);
  end if;
  select * into ch from memory.challenges where id = p_id;
  if ch.id is null or not memory.can_run_challenges(ch.group_id) then
    raise exception 'Challenge not found.' using errcode = 'P0002';
  end if;
  if v_end is not null and (v_end < ch.ends_on or v_end - ch.starts_on > 120) then
    raise exception 'The end date can only move later (up to 120 days after the start).' using errcode = '22023';
  end if;
  update memory.challenges set title = v_title, description = coalesce(p ->> 'description', description), goal_sessions = v_goal,
         ends_on = coalesce(v_end, ends_on), updated_at = now()
   where id = ch.id returning * into ch;
  perform memory.audit('memory.challenge_updated', 'memory_challenge', ch.id);
  return memory.challenge_json(ch, v_uid);
end;
$$;

create function public.memory_admin_challenge_status(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  ch memory.challenges;
begin
  select * into ch from memory.challenges where id = p_id;
  if ch.id is null or not memory.can_run_challenges(ch.group_id) then
    raise exception 'Challenge not found.' using errcode = 'P0002';
  end if;
  if p_action not in ('end', 'cancel') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  update memory.challenges set status = case p_action when 'end' then 'ended' else 'canceled' end, updated_at = now()
   where id = ch.id returning * into ch;
  perform memory.audit('memory.challenge_' || p_action || 'ed', 'memory_challenge', ch.id);
  return memory.challenge_json(ch, v_uid);
end;
$$;

revoke execute on all functions in schema memory from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'memory\_%challenge%' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;
