-- Phase 10 · Step 8 of 9: apply migration 20261028000800_youth_media_consent to the hosted project.
--
-- Run once in the SQL editor of The Gathering project:
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Photo consent integrated with gallery moderation: consent state, publication guard, review queue, photo associations, known copies.
--
-- It copies supabase/migrations/20261028000800_youth_media_consent.sql verbatim and records it in
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
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000700') then
    raise exception 'Nothing was changed: the previous step (20261028000700) is not recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000800') then
    raise exception 'Nothing was changed: 20261028000800 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261028000800_youth_media_consent.sql
-- =========================================================================
-- Phase 10 · Photo and video consent, integrated with Phase 7 gallery
-- moderation.
--
--   * Consent is versioned by decision record: who decided (a verified
--     guardian allowed to manage media consent), when, under which policy
--     version, for which scope (member galleries, or public use), optionally
--     for one event; withdrawal is recorded, never deleted.
--   * Member-gallery consent never implies public use. Public-use decisions
--     can be recorded only when the approved policy allows it, and the app
--     still publishes nothing publicly (galleries are never public).
--   * A consent reviewer manually associates a photo with the children shown
--     (no facial recognition, no automated detection).
--   * A photo can't be approved (or unhidden) while any associated child's
--     consent for that album's event is unknown, declined, withdrawn, or
--     conflicting between verified guardians. A moderator can't mark
--     "permission confirmed" without associations.
--   * When consent changes or a guardianship changes, affected approved
--     photos are hidden at once (storage reads stop with them) and queued for
--     review. Known copies and public reuse are tracked for follow-up;
--     screenshots and copies people already saved can't be recalled.

-- granted | declined | withdrawn | unknown | conflict
create function youth.media_state(p_child uuid, p_scope text, p_series uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_states text[];
begin
  -- Each currently verified guardian (allowed to manage media consent)
  -- counts once: their latest decision for this event if they made one,
  -- otherwise their latest general decision.
  select array_agg(x.state) into v_states from (
    select distinct on (mc.guardian_id) case when mc.withdrawn_at is not null then 'withdrawn' else mc.decision end as state
      from youth.media_consents mc
     where mc.child_id = p_child and mc.scope = p_scope
       and (mc.series_id is null or mc.series_id = p_series)
       and youth.guardian_can(p_child, mc.guardian_id, 'media_consent')
     order by mc.guardian_id, (mc.series_id is not null and mc.series_id = p_series) desc, mc.decided_at desc, mc.id desc) x;
  if v_states is null then
    return 'unknown';
  end if;
  if 'granted' = all(v_states) then
    return 'granted';
  end if;
  if 'granted' = any(v_states) then
    return 'conflict';
  end if;
  if 'declined' = any(v_states) then
    return 'declined';
  end if;
  return 'withdrawn';
end;
$$;

create function youth.photo_series(p_photo uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.event_series_id from media.photos ph join media.albums a on a.id = ph.album_id where ph.id = p_photo;
$$;

-- Null when every associated child has granted member-gallery consent for
-- this album's event; otherwise the first problem found.
create function youth.photo_consent_problem(p_photo uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.state from (
    select youth.media_state(ps.child_id, 'member_gallery', youth.photo_series(p_photo)) as state
      from youth.photo_subjects ps where ps.photo_id = p_photo) s
   where s.state <> 'granted'
   order by s.state limit 1;
$$;

create function youth.guard_photo_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if new.minors = 'permission_confirmed' and not exists (select 1 from youth.photo_subjects ps where ps.photo_id = new.id) then
      raise exception 'Associate this photo with the children shown (Youth → Photo consent) before confirming permission.' using errcode = '22023';
    end if;
    v_problem := youth.photo_consent_problem(new.id);
    if v_problem is not null then
      raise exception 'This photo can''t be published until photo consent is confirmed for everyone associated with it.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger photos_youth_consent
  before update of status on media.photos
  for each row execute function youth.guard_photo_publication();

-- Hides affected approved photos and queues them for review.
create function youth.media_reconcile(p_child uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_state text;
begin
  for r in
    select ph.id, ph.album_id, ph.status from youth.photo_subjects ps join media.photos ph on ph.id = ps.photo_id
     where ps.child_id = p_child and ph.status in ('approved', 'hidden', 'pending')
  loop
    v_state := youth.media_state(p_child, 'member_gallery', youth.photo_series(r.id));
    continue when v_state = 'granted';
    if r.status = 'approved' then
      update media.photos set status = 'hidden', review_reason = 'Hidden for a photo consent review.', updated_at = now() where id = r.id;
      insert into media.moderation_log (actor_id, action, photo_id, album_id, reason)
      values ((select auth.uid()), 'photo.consent_hidden', r.id, r.album_id, null);
      v_n := v_n + 1;
    end if;
    insert into youth.photo_reviews (photo_id, child_id, reason)
    values (r.id, p_child, case v_state when 'withdrawn' then 'consent_withdrawn' when 'declined' then 'consent_declined'
                                       when 'conflict' then 'consent_conflict' else 'consent_unknown' end)
    on conflict (photo_id, child_id) where status = 'open' do update set reason = excluded.reason;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardians
-- ---------------------------------------------------------------------------
-- {scope: member_gallery|public_use, decision: granted|declined, series_id?}
create function public.youth_media_consent_set(p_child uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  g youth.guardianships := youth.guardianship_of(p_child, v_uid);
  v_series uuid := nullif(p ->> 'series_id', '')::uuid;
  v_id uuid;
begin
  perform community.rate_limit(v_uid, 'youth_media_consent', 30, interval '10 minutes');
  if g.id is null or not youth.guardian_can(p_child, v_uid, 'media_consent') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if coalesce(p ->> 'scope', '') not in ('member_gallery', 'public_use') or coalesce(p ->> 'decision', '') not in ('granted', 'declined') then
    raise exception 'Choose a decision.' using errcode = '22023';
  end if;
  if p ->> 'scope' = 'public_use' and p ->> 'decision' = 'granted' and not youth.flag('public_media_consent') then
    raise exception 'Public use of photos isn''t offered under the church''s current policy.' using errcode = '22023';
  end if;
  if v_series is not null and not exists (select 1 from youth.event_settings es where es.series_id = v_series
                                             and youth.enrolled(es.group_id, p_child)) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  insert into youth.media_consents (child_id, scope, series_id, decision, guardian_id, guardianship_id, policy_id)
  values (p_child, p ->> 'scope', v_series, p ->> 'decision', v_uid, g.id, (youth.current_policy()).id)
  returning id into v_id;
  perform youth.family_event(p_child, g.id, 'media_consent.' || (p ->> 'decision'), null, null, array[p ->> 'scope']);
  perform youth.media_reconcile(p_child);
  perform youth.notify(x.guardian_id, 'youth_consent_changed', jsonb_build_object('youth_child_id', p_child),
                       'youth_media_consent:' || p_child)
     from youth.guardianships x
    where x.child_id = p_child and x.status = 'verified' and x.guardian_id <> v_uid and (x.can_media_consent or x.can_receive_updates);
  return jsonb_build_object('id', v_id, 'state', youth.media_state(p_child, p ->> 'scope', v_series));
end;
$$;

create function public.youth_media_consent_withdraw(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
  mc youth.media_consents;
begin
  select * into mc from youth.media_consents where id = p_id for update;
  if mc.id is null or not youth.guardian_can(mc.child_id, v_uid, 'media_consent') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  update youth.media_consents set withdrawn_at = now(), withdrawn_by = v_uid where id = mc.id and withdrawn_at is null;
  perform youth.family_event(mc.child_id, mc.guardianship_id, 'media_consent.withdrawn', null, null, array[mc.scope]);
  perform youth.media_reconcile(mc.child_id);
  perform youth.notify(x.guardian_id, 'youth_consent_changed', jsonb_build_object('youth_child_id', mc.child_id),
                       'youth_media_consent:' || mc.child_id)
     from youth.guardianships x
    where x.child_id = mc.child_id and x.status = 'verified' and x.guardian_id <> v_uid and (x.can_media_consent or x.can_receive_updates);
end;
$$;

create function public.youth_child_media(p_child uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_adult();
begin
  if not youth.guardian_can(p_child, v_uid, 'media_consent') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'member_gallery', youth.media_state(p_child, 'member_gallery', null),
    'public_use', youth.media_state(p_child, 'public_use', null),
    'public_use_offered', youth.flag('public_media_consent'),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', mc.id, 'scope', mc.scope, 'decision', mc.decision, 'decided_at', mc.decided_at,
                     'withdrawn_at', mc.withdrawn_at, 'mine', mc.guardian_id = v_uid,
                     'event', (select s.title from events.series s where s.id = mc.series_id))
                   order by mc.decided_at desc)
                 from youth.media_consents mc where mc.child_id = p_child), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('series_id', s.id, 'title', s.title,
                                                          'state', youth.media_state(p_child, 'member_gallery', s.id)) order by s.start_date)
                         from youth.event_settings es join events.series s on s.id = es.series_id
                        where youth.enrolled(es.group_id, p_child) and events.is_live(s.status, s.publish_at)
                          and exists (select 1 from events.occurrences o where o.series_id = s.id and o.ends_at > now() - interval '60 days')), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Consent reviewers (youth.media_consent)
-- ---------------------------------------------------------------------------
create function youth.photo_admin_json(ph media.photos)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', ph.id, 'album_id', ph.album_id, 'album', (select a.title from media.albums a where a.id = ph.album_id),
    'event', (select s.title from media.albums a join events.series s on s.id = a.event_series_id where a.id = ph.album_id),
    'youth_event', exists (select 1 from media.albums a join youth.event_settings es on es.series_id = a.event_series_id where a.id = ph.album_id),
    'status', ph.status, 'minors', ph.minors, 'thumb_path', ph.thumb_path, 'review_thumb_path', ph.review_thumb_path,
    'created_at', ph.created_at,
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('child_id', c.id, 'display_name', c.display_name,
                                                            'state', youth.media_state(c.id, 'member_gallery', youth.photo_series(ph.id)))
                                          order by lower(c.display_name))
                           from youth.photo_subjects ps join youth.children c on c.id = ps.child_id where ps.photo_id = ph.id), '[]'::jsonb),
    'reuse', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'location', r.location, 'recorded_at', r.recorded_at,
                                                         'removed_at', r.removed_at) order by r.recorded_at desc)
                        from youth.media_reuse r where r.photo_id = ph.id), '[]'::jsonb),
    'problem', youth.photo_consent_problem(ph.id));
$$;

create function public.youth_admin_media_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform youth.require_cap('youth.media_consent');
  return jsonb_build_object(
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'created_at', r.created_at,
                                                           'child', (select c.display_name from youth.children c where c.id = r.child_id),
                                                           'photo', youth.photo_admin_json(ph)) order by r.created_at)
                          from youth.photo_reviews r join media.photos ph on ph.id = r.photo_id where r.status = 'open'), '[]'::jsonb),
    -- Photos waiting for gallery approval in albums linked to youth events.
    'pending', coalesce((select jsonb_agg(youth.photo_admin_json(ph) order by ph.created_at)
                          from media.photos ph join media.albums a on a.id = ph.album_id
                          join youth.event_settings es on es.series_id = a.event_series_id
                         where ph.status = 'pending'), '[]'::jsonb));
end;
$$;

create function public.youth_admin_photo(p_photo uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ph media.photos;
begin
  perform youth.require_cap('youth.media_consent');
  select * into ph from media.photos where id = p_photo;
  if ph.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return youth.photo_admin_json(ph);
end;
$$;

-- Names only, for associating photos.
create function public.youth_admin_media_children(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  perform youth.require_cap('youth.media_consent');
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'display_name', c.display_name,
                                                     'state', youth.media_state(c.id, 'member_gallery', null)) order by lower(c.display_name))
     from (select * from youth.children c where c.status = 'active'
              and c.display_name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            order by lower(c.display_name) limit 20) c), '[]'::jsonb);
end;
$$;

create function public.youth_admin_photo_subject_set(p_photo uuid, p_child uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.media_consent');
  ph media.photos;
begin
  select * into ph from media.photos where id = p_photo for update;
  if ph.id is null or not exists (select 1 from youth.children where id = p_child) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_on then
    insert into youth.photo_subjects (photo_id, child_id, added_by) values (p_photo, p_child, v_uid) on conflict do nothing;
    perform youth.media_reconcile(p_child);
  else
    delete from youth.photo_subjects where photo_id = p_photo and child_id = p_child;
    update youth.photo_reviews set status = 'resolved', outcome = 'association_removed', resolved_by = v_uid, resolved_at = now()
     where photo_id = p_photo and child_id = p_child and status = 'open';
  end if;
  insert into media.moderation_log (actor_id, action, photo_id, album_id)
  values (v_uid, case when p_on then 'photo.subject_added' else 'photo.subject_removed' end, ph.id, ph.album_id);
  select * into ph from media.photos where id = p_photo;
  return youth.photo_admin_json(ph);
end;
$$;

-- outcome: kept_hidden | restored | removed
create function public.youth_admin_photo_review_resolve(p_review uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.media_consent');
  r youth.photo_reviews;
  ph media.photos;
begin
  select * into r from youth.photo_reviews where id = p_review and status = 'open' for update;
  if r.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into ph from media.photos where id = r.photo_id for update;
  case p_outcome
    when 'restored' then
      if youth.photo_consent_problem(ph.id) is not null then
        raise exception 'Consent isn''t confirmed for everyone associated with this photo.' using errcode = '22023';
      end if;
      if ph.status = 'hidden' and not exists (select 1 from youth.photo_reviews x where x.photo_id = ph.id and x.status = 'open' and x.id <> r.id) then
        update media.photos set status = 'approved', review_reason = null, updated_at = now() where id = ph.id;
      end if;
    when 'removed' then
      update media.photos set status = 'removed', review_reason = 'Removed after a photo consent review.', updated_at = now()
       where id = ph.id and status in ('approved', 'hidden', 'pending');
    when 'kept_hidden' then
      null;
    else
      raise exception 'Choose an outcome.' using errcode = '22023';
  end case;
  update youth.photo_reviews set status = 'resolved', outcome = p_outcome, resolved_by = v_uid, resolved_at = now() where id = r.id;
  insert into media.moderation_log (actor_id, action, photo_id, album_id) values (v_uid, 'photo.consent_' || p_outcome, ph.id, ph.album_id);
end;
$$;

-- {kind: derivative|public_reuse, location} or p_remove = the reuse id.
create function public.youth_admin_media_reuse(p_photo uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.media_consent');
begin
  if nullif(p ->> 'remove', '') is not null then
    update youth.media_reuse set removed_at = now() where id = (p ->> 'remove')::uuid and photo_id = p_photo;
    return;
  end if;
  if coalesce(p ->> 'kind', '') not in ('derivative', 'public_reuse') or btrim(coalesce(p ->> 'location', '')) = '' then
    raise exception 'Describe where the copy is.' using errcode = '22023';
  end if;
  insert into youth.media_reuse (photo_id, kind, location, recorded_by) values (p_photo, p ->> 'kind', left(btrim(p ->> 'location'), 300), v_uid);
end;
$$;

revoke execute on all functions in schema youth from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261028000800', 'youth_media_consent', 'phase-10');

commit;
