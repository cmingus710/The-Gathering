-- Phase 10 · Youth ministry and families, follow-up: the adult transition is
-- completed by a different family administrator than the one who started it.
--
-- docs/youth-retention.md and the family administrator guide require two
-- people (one starts after reassessing eligibility and identity, another
-- completes). The hosted walkthrough found that the function only refused the
-- youth themselves, so the administrator who started a transition could also
-- complete it. Same body as 20261028000500, plus the started_by check.
create or replace function public.youth_admin_transition_complete(p_id uuid, p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('family.verify');
  t youth.transitions;
begin
  select * into t from youth.transitions where id = p_id for update;
  if t.id is null or t.status <> 'confirmed' then
    raise exception 'The youth must confirm before the transition can be completed.' using errcode = '22023';
  end if;
  if t.account_id = v_uid then
    raise exception 'Someone else must complete this transition.' using errcode = '22023';
  end if;
  if t.started_by is null or t.started_by = v_uid then
    raise exception 'A different family administrator must complete this transition.' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> 'complete transition' then
    raise exception 'Type "complete transition" to confirm.' using errcode = '22023';
  end if;
  if not youth.flag('adult_transition') then
    raise exception 'Adult transition isn''t available under the church''s current policy.' using errcode = '22023';
  end if;
  perform set_config('youth.context', 'on', true);
  update public.profiles set account_kind = 'adult' where id = t.account_id;
  perform set_config('youth.context', '', true);
  -- Personal learning history stays with the account. Guardian visibility,
  -- youth groups, and youth event places end. Direct messaging is NOT
  -- granted: a membership administrator decides that separately.
  update youth.guardianships set status = 'ended' where child_id = t.child_id and status in ('pending', 'verified', 'suspended');
  update youth.enrollments set status = 'left', ended_at = now(), ended_by = v_uid where child_id = t.child_id and status = 'active';
  update youth.registrations r set status = 'canceled', canceled_at = now(), cancel_reason = 'ineligible', updated_at = now()
    from events.occurrences o
   where o.id = r.occurrence_id and r.child_id = t.child_id and r.status <> 'canceled' and o.ends_at > now();
  delete from youth.progress_sharing where child_id = t.child_id;
  update youth.account_records set ended_at = now(), ended_reason = 'adult_transition' where child_id = t.child_id and ended_at is null;
  update youth.children set status = 'transitioned' where id = t.child_id;
  update youth.transitions set status = 'completed', completed_by = v_uid, completed_at = now() where id = t.id;
  perform youth.family_event(t.child_id, null, 'transition.completed', 'confirmed', 'completed');
  perform youth.audit('youth.transition_completed', 'youth_child', t.child_id);
  perform youth.after_access_change(t.child_id);
end;
$$;
