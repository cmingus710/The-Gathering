-- Prayer requests · no length limit on the request itself (additive).
--
-- The companion to 20261127000100 (the Prayer Library). A member writing
-- out what they would like prayer for was stopped at 4,000 characters
-- ("Keep it to 4,000 characters."), which is short for a hard season told
-- properly. The limit is removed everywhere a member meets it:
--
--   * prayer.clean_body(text, text) is new: the helper from 20261127000100
--     with the caller's own label, so each refusal still reads in the
--     words of the thing being written ("Your request is too short.").
--     prayer.clean_body(text) stays, and now calls it with "The prayer",
--     so the Prayer Library keeps the wording and behaviour it has.
--   * public.prayer_request_save (same signature, grants unchanged) cleans
--     the body with it instead of
--     community.clean_text(p_body, 1, 4000, 'Your request'). Every other
--     rule it enforces is unchanged.
--   * the prayer.requests.body check keeps the "not empty" half and drops
--     the 4,000 ceiling. Every value the old check allowed is still
--     allowed, so no row is rewritten or invalidated.
--
-- Prayer requests are not full-text indexed, so there is no search vector
-- to bound here (unlike the Prayer Library). Mention parsing, audience and
-- confirmation rules, rate limits, notifications, and the audit log are
-- untouched.
--
-- Dated updates (2,000), comments (2,000), reports (1,000), the title
-- (120), and everything in prayer care keep their limits.

-- ---------------------------------------------------------------------------
-- The body, cleaned without a ceiling
-- ---------------------------------------------------------------------------
create function prayer.clean_body(p text, p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p, ''));
begin
  -- Strip control characters other than tab and newline, as community.clean_text does.
  v := regexp_replace(v, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  if char_length(v) < 1 then
    raise exception '% is too short.', p_label using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Unchanged behaviour (20261127000100): the Prayer Library's wording, now
-- from the shared helper.
create or replace function prayer.clean_body(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select prayer.clean_body(p, 'The prayer');
$$;

alter table prayer.requests drop constraint requests_body_check;
alter table prayer.requests add constraint requests_body_check check (char_length(btrim(body)) >= 1);

-- ---------------------------------------------------------------------------
-- Writing a request
-- ---------------------------------------------------------------------------
-- Unchanged from 20261024000300 except v_body, which is no longer capped.
create or replace function public.prayer_request_save(
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
  v_body text := prayer.clean_body(p_body, 'Your request');
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Both helpers stay private, like every helper in the schema; the public
-- function keeps the grants it already has.
revoke execute on all functions in schema prayer from public, anon, authenticated;
