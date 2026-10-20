-- Phase 9 · Memory practice: My Verses, collections for members, practice
-- sessions with server-side scoring, the spaced-review schedule, progress,
-- badges, settings, export, and deletion.
--
-- Owner only. Every function filters on profile_id = auth.uid() (after
-- memory.require_member). No staff path reads cards, sessions, attempts,
-- settings, or awards; group leaders and household members get nothing.
--
-- Scoring happens here, against the session the server created, so a client
-- can't submit its own accuracy, review step, or badge:
--   * the session stores what was hidden or shuffled and the passage
--     version shown; a submission is scored once (retries return the same
--     result) and only if that card is still active
--   * hints are counted on the server when they're shown
--   * read & repeat, flashcards, and self-check are never machine-scored;
--     self-check records only what the member reports
--
-- Review schedule (documented in docs/memory-scoring.md):
--   steps 0–7 with intervals 0, 1, 2, 4, 7, 14, 30, 60 days, in the
--   member's own calendar (dates, so time zones and daylight saving can't
--   shift a review). At most one schedule change per verse per day.
--   strong recall (every word right, no hints; or "I knew it fully" on a
--   self-check) when due → next step; partial (80% or more, or hints) →
--   same step, sooner;
--   needs practice → back one step, tomorrow. Early reviews and learning
--   activities count as practice without moving the schedule (except that a
--   strong first try moves a new verse to "learning"). Missed days never
--   lower a step and nothing is deleted.

-- ---------------------------------------------------------------------------
-- Constants and small helpers
-- ---------------------------------------------------------------------------
create function memory.interval_for(p_step integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (array[0, 1, 2, 4, 7, 14, 30, 60])[least(greatest(p_step, 0), 7) + 1];
$$;

create function memory.stage(p_step integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_step <= 0 then 'new' when p_step <= 2 then 'learning' when p_step <= 5 then 'reviewing' else 'well_known' end;
$$;

create function memory.settings_of(p_profile uuid)
returns memory.member_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s memory.member_settings;
begin
  select * into s from memory.member_settings where profile_id = p_profile;
  if not found then
    s.profile_id := p_profile;
    s.difficulty := 'guided';
    s.presentation := 'standard';
    s.ignore_case := true;
    s.ignore_punctuation := true;
    s.celebrations := true;
    s.paused := false;
    s.remind_weekly := false;
    s.remind_review := false;
    s.remind_practice := false;
    s.remind_challenge := false;
    s.reminder_time := '18:00';
  end if;
  return s;
end;
$$;

create function memory.settings_json(s memory.member_settings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'difficulty', s.difficulty, 'presentation', s.presentation, 'ignore_case', s.ignore_case,
    'ignore_punctuation', s.ignore_punctuation, 'celebrations', s.celebrations, 'daily_goal', s.daily_goal,
    'timezone', s.timezone, 'effective_timezone', memory.member_tz(s.profile_id), 'paused', s.paused,
    'remind_weekly', s.remind_weekly, 'remind_review', s.remind_review, 'remind_practice', s.remind_practice,
    'remind_challenge', s.remind_challenge, 'reminder_time', to_char(s.reminder_time, 'HH24:MI'));
$$;

-- Deterministic order for the server's choices (shuffles, blanks).
create function memory.rank(p_seed uuid, p_n integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(p_seed::text || ':' || p_n);
$$;

-- The tokens of a range with their comparison keys (words only).
create function memory.words(p_tokens jsonb, p_from integer, p_to integer, p_case boolean, p_punct boolean)
returns table (idx integer, t text, k text)
language sql
immutable
set search_path = ''
as $$
  select (n - 1)::integer, e ->> 't', memory.word_key(e ->> 't', p_case, p_punct)
    from jsonb_array_elements(p_tokens) with ordinality x(e, n)
   where n - 1 between p_from and p_to and memory.word_key(e ->> 't', p_case, true) <> ''
   order by n;
$$;

-- ---------------------------------------------------------------------------
-- Scoring (pure; also used by the staff preview)
-- ---------------------------------------------------------------------------
-- Typed recall: word-by-word alignment (longest common subsequence) of the
-- member's words against the passage. Verse numbers the member typed (that
-- the passage itself doesn't contain) and the reference typed at the start
-- or end are recognized and set aside, never counted as scripture.
-- accuracy = matched words / (passage words + extra words), so additions,
-- omissions, and substitutions all count; nothing that changes the wording
-- is accepted.
create function memory.score_typed(p_tokens jsonb, p_from integer, p_to integer, p_typed text,
                                   p_case boolean, p_punct boolean, p_book_name text, p_verse_numbers integer[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  s_t text[];
  s_k text[];
  r_t text[] := '{}';
  r_k text[] := '{}';
  t_t text[];
  t_k text[];
  l_k text[];
  n integer;
  m integer;
  dp integer[];
  i integer;
  j integer;
  w integer;
  v_ops jsonb := '[]'::jsonb;
  v_matched integer := 0;
  v_numbers integer := 0;
  v_reference boolean := false;
  v_src_numbers text[];
  v_tok record;
begin
  select array_agg(w.t order by w.idx), array_agg(w.k order by w.idx) into s_t, s_k
    from memory.words(p_tokens, p_from, p_to, p_case, p_punct) w;
  n := coalesce(cardinality(s_t), 0);
  -- The member's words (same tokenizer and keys).
  for v_tok in select q.t from memory.split_tokens(left(coalesce(p_typed, ''), 20000)) with ordinality q(t, g, b, o) order by o loop
    continue when memory.word_key(v_tok.t, true, true) = '';
    r_t := r_t || v_tok.t;
    r_k := r_k || memory.word_key(v_tok.t, p_case, p_punct);
  end loop;
  if cardinality(r_t) > 3 * n + 40 then
    r_t := r_t[1:3 * n + 40];
    r_k := r_k[1:3 * n + 40];
  end if;
  -- The reference typed first or last: the book's name (or "Psalm")
  -- followed by chapter:verse, like "John 3:16" or "Psalm 23:1–6" (a range
  -- arrives as two tokens, "3:16–" and "17").
  select array_agg(memory.word_key(q.t, true, true) order by o) into l_k
    from memory.split_tokens(coalesce(p_book_name, '')) with ordinality q(t, g, b, o) where memory.word_key(q.t, true, true) <> '';
  w := coalesce(cardinality(l_k), 0);
  if w > 0 and cardinality(r_t) > w + 1 then
    -- At the start.
    if (select array_agg(memory.word_key(x, true, true) order by o) from unnest(r_t[1:w]) with ordinality u(x, o)) in (l_k, array['psalm'])
       and r_t[w + 1] ~ '^[0-9]+[:.][0-9]+([-–][0-9:]*)?[,.;)]?$' then
      i := w + 1;
      if r_t[i] ~ '[-–]$' and r_t[i + 1] ~ '^[0-9:]+[,.;)]?$' then
        i := i + 1;
      end if;
      r_t := r_t[i + 1:]; r_k := r_k[i + 1:]; v_reference := true;
    else
      -- At the end ("… through him. John 3:17").
      i := cardinality(r_t);
      if r_t[i] ~ '^[0-9:]+[,.;)]?$' and r_t[i - 1] ~ '^[0-9]+[:.][0-9]+[-–]$' then
        i := i - 1;
      end if;
      if r_t[i] ~ '^[0-9]+[:.][0-9]+([-–][0-9:]*)?[,.;)]?$' and i - w >= 1
         and (select array_agg(memory.word_key(x, true, true) order by o) from unnest(r_t[i - w:i - 1]) with ordinality u(x, o)) in (l_k, array['psalm']) then
        r_t := r_t[1:i - w - 1]; r_k := r_k[1:i - w - 1]; v_reference := true;
      end if;
    end if;
  end if;
  -- Verse numbers: digits the passage doesn't contain, matching a verse in range.
  select array_agg(x) into v_src_numbers from unnest(s_k) x where x ~ '^[0-9]+$';
  t_t := '{}'; t_k := '{}';
  for i in 1 .. coalesce(cardinality(r_t), 0) loop
    if r_k[i] ~ '^[0-9]+$' and r_k[i]::numeric < 1000 and r_k[i]::integer = any(coalesce(p_verse_numbers, '{}'))
       and not (r_k[i] = any(coalesce(v_src_numbers, '{}'))) then
      v_numbers := v_numbers + 1;
      continue;
    end if;
    t_t := t_t || r_t[i];
    t_k := t_k || r_k[i];
  end loop;
  m := coalesce(cardinality(t_t), 0);
  -- dp[(i)(m+1) + j + 1] = LCS length of s[i+1..n] and t[j+1..m].
  dp := array_fill(0, array[(n + 1) * (m + 1)]);
  for i in reverse n - 1 .. 0 loop
    for j in reverse m - 1 .. 0 loop
      if s_k[i + 1] = t_k[j + 1] then
        dp[i * (m + 1) + j + 1] := dp[(i + 1) * (m + 1) + (j + 1) + 1] + 1;
      else
        dp[i * (m + 1) + j + 1] := greatest(dp[(i + 1) * (m + 1) + j + 1], dp[i * (m + 1) + (j + 1) + 1]);
      end if;
    end loop;
  end loop;
  i := 0; j := 0;
  while i < n or j < m loop
    if i < n and j < m and s_k[i + 1] = t_k[j + 1] then
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'match', 'expected', s_t[i + 1], 'typed', t_t[j + 1],
                                                             'exact', s_t[i + 1] = t_t[j + 1]));
      v_matched := v_matched + 1; i := i + 1; j := j + 1;
    elsif i < n and j < m and dp[(i + 1) * (m + 1) + (j + 1) + 1] = dp[i * (m + 1) + j + 1] then
      -- Skipping both loses nothing: a changed word.
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'changed', 'expected', s_t[i + 1], 'typed', t_t[j + 1]));
      i := i + 1; j := j + 1;
    elsif j >= m or (i < n and dp[(i + 1) * (m + 1) + j + 1] >= dp[i * (m + 1) + (j + 1) + 1]) then
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'missing', 'expected', s_t[i + 1]));
      i := i + 1;
    else
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'extra', 'typed', t_t[j + 1]));
      j := j + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'accuracy', case when n = 0 then 0 else round(v_matched::numeric / (n + (m - v_matched)), 3) end,
    'matched', v_matched, 'expected', n, 'typed', m, 'extra', m - v_matched,
    'reference_detected', v_reference, 'verse_numbers_ignored', v_numbers, 'ops', v_ops);
end;
$$;

-- Missing words: each blank's answer against the hidden word (punctuation
-- around the blank is shown, so it's never required; case per settings).
create function memory.score_blanks(p_tokens jsonb, p_blanks integer[], p_answers jsonb, p_case boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'accuracy', case when count(*) = 0 then 0 else round(count(*) filter (where ok)::numeric / count(*), 3) end,
    'correct', count(*) filter (where ok), 'blanks', count(*),
    'results', coalesce(jsonb_agg(jsonb_build_object('blank', k, 'correct', ok, 'answer', ans, 'expected', core) order by k), '[]'::jsonb))
    from (
      select b.k, b.idx, left(coalesce(p_answers ->> b.idx::text, ''), 100) as ans,
             memory.token_core(p_tokens -> b.idx ->> 't') ->> 'core' as core,
             memory.word_key(coalesce(p_answers ->> b.idx::text, ''), p_case, true) <> ''
               and memory.word_key(coalesce(p_answers ->> b.idx::text, ''), p_case, true)
                   = memory.word_key(p_tokens -> b.idx ->> 't', p_case, true) as ok
        from unnest(p_blanks) with ordinality b(idx, k)
    ) x;
$$;

-- Word order: a position is right when the chip placed there reads the
-- same as the one that belongs there, so identical words or phrases
-- (repeated "the", "and he") are interchangeable while each chip keeps its
-- own stable identity.
create function memory.score_order(p_tokens jsonb, p_chips jsonb, p_order jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_expected text[];
  v_given text[];
  v_ids text[];
  n integer := jsonb_array_length(p_chips);
  v_correct integer := 0;
  i integer;
  v_results jsonb := '[]'::jsonb;
begin
  select array_agg(x ->> 'id' order by (x ->> 'from')::integer) into v_ids from jsonb_array_elements(p_chips) x;
  if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n
     or (select count(distinct v) from jsonb_array_elements_text(p_order) v) <> n
     or exists (select 1 from jsonb_array_elements_text(p_order) v where not (v = any(v_ids))) then
    raise exception 'Place every word before checking.' using errcode = '22023';
  end if;
  select array_agg(memory.chip_key(p_tokens, x) order by (x ->> 'from')::integer) into v_expected from jsonb_array_elements(p_chips) x;
  select array_agg(memory.chip_key(p_tokens, (select c from jsonb_array_elements(p_chips) c where c ->> 'id' = o.v)) order by o.n)
    into v_given from jsonb_array_elements_text(p_order) with ordinality o(v, n);
  for i in 1 .. n loop
    if v_given[i] = v_expected[i] then
      v_correct := v_correct + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('position', i, 'id', p_order ->> (i - 1), 'correct', v_given[i] = v_expected[i]));
  end loop;
  return jsonb_build_object('accuracy', case when n = 0 then 0 else round(v_correct::numeric / n, 3) end,
                            'correct', v_correct, 'chips', n, 'results', v_results);
end;
$$;

create function memory.chip_key(p_tokens jsonb, p_chip jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(memory.word_key(e ->> 't', true, true), ' ' order by n)
    from jsonb_array_elements(p_tokens) with ordinality x(e, n)
   where n - 1 between (p_chip ->> 'from')::integer and (p_chip ->> 'to')::integer;
$$;

-- Activity outcome for the schedule. Learning activities (read & repeat,
-- choice-based missing words and word order) help get to know a verse;
-- recall activities (typing, self-check, flashcards, and the typed or
-- single-word Challenge versions) move it along the schedule.
create function memory.is_recall(p_activity memory.activity, p_difficulty memory.difficulty)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_activity in ('type_verse', 'self_check', 'flashcards')
      or (p_activity in ('missing_words', 'word_order') and p_difficulty = 'challenge');
$$;

create function memory.quality_of(p_activity memory.activity, p_accuracy numeric, p_hints integer, p_confidence text)
returns memory.quality
language sql
immutable
set search_path = ''
as $$
  select case
    when p_activity = 'read_repeat' then 'none'::memory.quality
    when p_accuracy is null then
      case when p_confidence = 'fully' and p_hints = 0 then 'strong'::memory.quality
           when p_confidence in ('fully', 'mostly') then 'partial'::memory.quality
           else 'practice'::memory.quality end
    when p_accuracy >= 1 and p_hints = 0 and coalesce(p_confidence, 'fully') in ('mostly', 'fully') then 'strong'::memory.quality
    when p_accuracy >= 0.8 then 'partial'::memory.quality
    else 'practice'::memory.quality
  end;
$$;

-- ---------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------
create function memory.card_json(k memory.cards, p_with_text boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p memory.passages;
  i memory.items;
  c memory.collections;
  v_today date := memory.local_today(memory.member_tz(k.profile_id));
  v_update jsonb;
  v_item jsonb;
begin
  select * into p from memory.passages where id = k.passage_id;
  if k.item_id is not null then
    select * into i from memory.items where id = k.item_id;
    select * into c from memory.collections where id = i.collection_id;
    if memory.collection_visible(c, k.profile_id) or c.audience = 'personal' and c.owner_id = k.profile_id then
      v_item := jsonb_build_object('id', i.id, 'title', i.title, 'note', i.note, 'hint', i.hint,
                                   'collection', jsonb_build_object('id', c.id, 'title', c.title, 'audience', c.audience));
    end if;
  end if;
  -- A newer text: the church updated the collection's verse, or the source
  -- itself changed. Either way the member decides; nothing switches by itself.
  if k.status = 'active' then
    if v_item is not null and i.passage_id <> k.passage_id then
      v_update := jsonb_build_object('source', 'collection',
        'reason', (select v.reason from memory.item_versions v where v.item_id = i.id and v.from_passage_id = k.passage_id order by v.changed_at desc limit 1));
    elsif p.superseded_by is not null or not memory.passage_current(p) then
      v_update := jsonb_build_object('source', 'bible', 'reason', null);
    end if;
  end if;
  return jsonb_build_object(
    'id', k.id, 'status', k.status, 'step', k.step, 'stage', memory.stage(k.step), 'review_ready', k.best_step >= 3,
    'best_step', k.best_step, 'due_on', k.due_on, 'due', k.status = 'active' and (k.due_on is null or k.due_on <= v_today),
    'sessions', k.sessions, 'last_practiced_at', k.last_practiced_at, 'added_at', k.added_at,
    'previous_card_id', k.previous_card_id, 'passage', memory.passage_json(p, p_with_text),
    'item', v_item, 'update_available', v_update,
    'translation_available', bible.translation_active(p.translation_id));
end;
$$;

-- A member's card for a visible item, if any (any version of its reference).
create function memory.my_card_for_item(i memory.items, p_profile uuid)
returns memory.cards
language sql
stable
security definer
set search_path = ''
as $$
  select k.* from memory.cards k
   where k.profile_id = p_profile and k.status = 'active'
     and (k.item_id = i.id or k.passage_id = i.passage_id)
   order by k.passage_id = i.passage_id desc
   limit 1;
$$;

create function memory.member_item_json(i memory.items, p_profile uuid, p_with_text boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select memory.item_json(i, p_with_text) || jsonb_build_object(
    'card', (select case when k.id is null then null else jsonb_build_object('id', k.id, 'stage', memory.stage(k.step), 'sessions', k.sessions,
                                                                            'review_ready', k.best_step >= 3, 'current_version', k.passage_id = i.passage_id) end
               from memory.my_card_for_item(i, p_profile) k));
$$;

-- Current assignments a member can see: items whose window includes today
-- (in the collection's time zone).
create function memory.current_items(p_profile uuid)
returns setof memory.items
language sql
stable
security definer
set search_path = ''
as $$
  select i.* from memory.items i join memory.collections c on c.id = i.collection_id
   where i.retired_at is null and i.starts_on is not null and c.audience <> 'personal'
     and memory.collection_visible(c, p_profile)
     and memory.local_today(c.timezone) between i.starts_on and i.ends_on
   order by i.starts_on desc, c.sort_order, i.position;
$$;

-- ---------------------------------------------------------------------------
-- Home, assignments, and collections
-- ---------------------------------------------------------------------------
create function public.memory_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  s memory.member_settings := memory.settings_of(v_uid);
  v_today date := memory.local_today(memory.member_tz(v_uid));
begin
  return jsonb_build_object(
    'today', v_today,
    'settings', memory.settings_json(s),
    -- Whether to offer the group leader's tools (a group they lead is authorized).
    'leads', exists (select 1 from memory.group_authorizations a where community.group_leader(a.group_id, v_uid)),
    'assignments', coalesce((select jsonb_agg(memory.member_item_json(i, v_uid, true) || jsonb_build_object(
                                     'collection', jsonb_build_object('id', c.id, 'title', c.title, 'kind', c.kind, 'goal_note', c.goal_note,
                                                                      'goal_sessions_per_week', c.goal_sessions_per_week)))
                               from memory.current_items(v_uid) i join memory.collections c on c.id = i.collection_id), '[]'::jsonb),
    'due_count', (select count(*) from memory.cards k where k.profile_id = v_uid and k.status = 'active'
                    and bible.translation_active((select p.translation_id from memory.passages p where p.id = k.passage_id))
                    and (k.due_on is null or k.due_on <= v_today)),
    'card_count', (select count(*) from memory.cards k where k.profile_id = v_uid and k.status = 'active'),
    'done_today', (select count(*) from memory.attempts a where a.profile_id = v_uid and a.local_date = v_today and a.completed),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'title', ch.title, 'ends_on', ch.ends_on,
                                                                'joined', cp.profile_id is not null and cp.left_at is null))
                              from memory.challenges ch
                              left join memory.challenge_participants cp on cp.challenge_id = ch.id and cp.profile_id = v_uid
                             where ch.status = 'active' and community.group_member(ch.group_id, v_uid)
                               and ch.ends_on >= memory.local_today(memory.church_tz())), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(memory.card_json(k) order by k.last_practiced_at desc nulls last)
                          from (select * from memory.cards k where k.profile_id = v_uid and k.status = 'active'
                                 order by k.last_practiced_at desc nulls last, k.added_at desc limit 4) k), '[]'::jsonb));
end;
$$;

-- The compact home card: only when there is a current assignment.
create function public.memory_home_card()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  v_today date := memory.local_today(memory.member_tz(v_uid));
begin
  select * into i from memory.current_items(v_uid) limit 1;
  if i.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'item', memory.member_item_json(i, v_uid, false),
    'collection', (select jsonb_build_object('id', c.id, 'title', c.title) from memory.collections c where c.id = i.collection_id),
    'more', (select count(*) - 1 from memory.current_items(v_uid)),
    'due_count', (select count(*) from memory.cards k where k.profile_id = v_uid and k.status = 'active'
                    and (k.due_on is null or k.due_on <= v_today)));
end;
$$;

create function public.memory_assignments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  return jsonb_build_object(
    'current', coalesce((select jsonb_agg(memory.member_item_json(i, v_uid, true) || jsonb_build_object(
                                 'collection', jsonb_build_object('id', c.id, 'title', c.title, 'kind', c.kind, 'goal_note', c.goal_note,
                                                                  'goal_sessions_per_week', c.goal_sessions_per_week)))
                           from memory.current_items(v_uid) i join memory.collections c on c.id = i.collection_id), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(memory.member_item_json(i, v_uid, false) || jsonb_build_object(
                                  'collection', jsonb_build_object('id', c.id, 'title', c.title)) order by i.starts_on, i.position)
                            from memory.items i join memory.collections c on c.id = i.collection_id
                           where i.retired_at is null and c.audience <> 'personal' and memory.collection_visible(c, v_uid)
                             and i.starts_on > memory.local_today(c.timezone) and i.starts_on <= memory.local_today(c.timezone) + 42), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(memory.member_item_json(i, v_uid, false) || jsonb_build_object(
                                'collection', jsonb_build_object('id', c.id, 'title', c.title)) order by i.ends_on desc)
                          from (select i.* from memory.items i join memory.collections c on c.id = i.collection_id
                                 where i.retired_at is null and c.audience <> 'personal' and memory.collection_visible(c, v_uid)
                                   and i.ends_on < memory.local_today(c.timezone) and i.ends_on >= memory.local_today(c.timezone) - 56
                                 order by i.ends_on desc limit 8) i
                          join memory.collections c on c.id = i.collection_id), '[]'::jsonb));
end;
$$;

create function public.memory_collections()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  return jsonb_build_object(
    'church', coalesce((select jsonb_agg(memory.collection_json(c) || jsonb_build_object(
                                 'practiced', (select count(*) from memory.items i where i.collection_id = c.id and i.retired_at is null
                                                 and (memory.my_card_for_item(i, v_uid)).sessions > 0))
                               order by c.sort_order, c.publish_at desc)
                          from memory.collections c
                         where c.audience <> 'personal' and memory.collection_visible(c, v_uid)), '[]'::jsonb),
    'personal', coalesce((select jsonb_agg(memory.collection_json(c) order by c.title)
                            from memory.collections c where c.audience = 'personal' and c.owner_id = v_uid and c.status <> 'archived'), '[]'::jsonb));
end;
$$;

create function public.memory_collection(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections;
begin
  select * into c from memory.collections where id = p_id;
  if c.id is null or not memory.collection_visible(c, v_uid) then
    raise exception 'Collection not found.' using errcode = 'P0002';
  end if;
  return memory.collection_json(c) || jsonb_build_object(
    'mine', c.audience = 'personal',
    'items', coalesce((select jsonb_agg(memory.member_item_json(i, v_uid, true) order by i.position)
                         from memory.items i where i.collection_id = c.id and i.retired_at is null), '[]'::jsonb),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'title', ch.title, 'starts_on', ch.starts_on, 'ends_on', ch.ends_on))
                              from memory.challenges ch
                             where ch.collection_id = c.id and ch.status = 'active' and community.group_member(ch.group_id, v_uid)), '[]'::jsonb));
end;
$$;

-- Validates a passage for adding to My Verses and returns its exact text
-- (nothing is saved).
create function public.memory_passage_preview(p_translation uuid, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  v_problem text;
  t bible.translations;
  v_book text := p ->> 'book';
  v_sc integer := (p ->> 'sc')::integer;
  v_sv integer := (p ->> 'sv')::integer;
  v_ec integer := coalesce((p ->> 'ec')::integer, (p ->> 'sc')::integer);
  v_ev integer := (p ->> 'ev')::integer;
begin
  perform community.rate_limit(v_uid, 'memory_read', 300, interval '10 minutes');
  v_problem := memory.passage_problem(p_translation, v_book, v_sc, v_sv, v_ec, v_ev);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'problem', v_problem);
  end if;
  select * into t from bible.translations where id = p_translation;
  return jsonb_build_object('ok', true, 'label', bible.passage_label(v_book, v_sc, v_sv, v_ec, v_ev),
    'book', v_book, 'sc', v_sc, 'sv', v_sv, 'ec', v_ec, 'ev', v_ev,
    'translation', bible.translation_json(t), 'verses', bible.verses_json(p_translation, v_book, v_sc, v_sv, v_ec, v_ev));
end;
$$;

-- ---------------------------------------------------------------------------
-- My Verses
-- ---------------------------------------------------------------------------
-- p: {item_id} (from a visible collection) or {translation_id, book, sc, sv,
-- ec, ev} (personal). Idempotent: an existing card is returned (and
-- restored if it had been removed, with its history).
create function public.memory_card_add(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  c memory.collections;
  v_passage uuid;
  k memory.cards;
  v_ref text;
begin
  perform community.rate_limit(v_uid, 'memory_card', 120, interval '10 minutes');
  if p ? 'item_id' then
    select * into i from memory.items where id = nullif(p ->> 'item_id', '')::uuid and retired_at is null;
    select * into c from memory.collections where id = i.collection_id;
    if i.id is null or not memory.collection_visible(c, v_uid) then
      raise exception 'That verse isn''t available.' using errcode = 'P0002';
    end if;
    v_passage := i.passage_id;
  else
    v_passage := memory.capture_passage(nullif(p ->> 'translation_id', '')::uuid, p ->> 'book', (p ->> 'sc')::integer, (p ->> 'sv')::integer,
                                        coalesce((p ->> 'ec')::integer, (p ->> 'sc')::integer), (p ->> 'ev')::integer);
  end if;
  if not bible.translation_active((select translation_id from memory.passages where id = v_passage)) then
    raise exception 'That Bible version isn''t available.' using errcode = '22023';
  end if;
  select * into k from memory.cards where profile_id = v_uid and passage_id = v_passage;
  if k.id is not null then
    if k.status = 'removed' then
      update memory.cards set status = 'active', removed_at = null, updated_at = now(),
             item_id = coalesce(item_id, i.id)
       where id = k.id returning * into k;
    end if;
    return memory.card_json(k);
  end if;
  -- An active card for another text version of this reference: the member
  -- chooses explicitly (memory_card_switch_version) instead.
  select ref_key into v_ref from memory.passages where id = v_passage;
  if exists (select 1 from memory.cards x join memory.passages y on y.id = x.passage_id
              where x.profile_id = v_uid and x.status = 'active' and y.ref_key = v_ref and y.id <> v_passage) then
    raise exception 'You''re already practicing this verse in an earlier text. Open it in My Verses to choose the updated text.' using errcode = '22023';
  end if;
  if (select count(*) from memory.cards x where x.profile_id = v_uid and x.status = 'active') >= 500 then
    raise exception 'My Verses can hold up to 500 verses. Remove some first.' using errcode = '22023';
  end if;
  insert into memory.cards (profile_id, passage_id, item_id, due_on)
  values (v_uid, v_passage, i.id, memory.local_today(memory.member_tz(v_uid)))
  returning * into k;
  return memory.card_json(k);
end;
$$;

create function public.memory_cards()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  return jsonb_build_object(
    'active', coalesce((select jsonb_agg(memory.card_json(k) order by k.due_on nulls first, k.added_at desc)
                          from memory.cards k where k.profile_id = v_uid and k.status = 'active'), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(memory.card_json(k) order by k.removed_at desc)
                           from memory.cards k where k.profile_id = v_uid and k.status in ('removed', 'superseded')), '[]'::jsonb));
end;
$$;

create function public.memory_card(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
begin
  select * into k from memory.cards where id = p_id and profile_id = v_uid;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  return memory.card_json(k, true) || jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('activity', a.activity, 'difficulty', a.difficulty, 'segment', a.segment,
                                                             'accuracy', a.accuracy, 'hints', a.hints, 'confidence', a.confidence,
                                                             'quality', a.quality, 'step_before', a.step_before, 'step_after', a.step_after,
                                                             'date', a.local_date, 'at', a.created_at) order by a.created_at desc)
                           from (select * from memory.attempts a where a.card_id = k.id order by a.created_at desc limit 50) a), '[]'::jsonb),
    'earlier', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'version', y.version, 'sessions', x.sessions, 'status', x.status))
                           from memory.cards x join memory.passages y on y.id = x.passage_id
                          where x.profile_id = v_uid and x.id <> k.id
                            and y.ref_key = (select ref_key from memory.passages where id = k.passage_id)
                            and y.translation_id = (select translation_id from memory.passages where id = k.passage_id)), '[]'::jsonb),
    'settings', memory.settings_json(memory.settings_of(v_uid)));
end;
$$;

-- remove: hidden from My Verses, history kept (can be restored).
-- delete: the verse and its practice history, permanently (p_confirm =
--         'delete'). The approved scripture itself is never deleted.
create function public.memory_card_remove(p_id uuid, p_mode text, p_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
begin
  select * into k from memory.cards where id = p_id and profile_id = v_uid for update;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  if p_mode = 'remove' then
    update memory.cards set status = 'removed', removed_at = coalesce(removed_at, now()), updated_at = now()
     where id = k.id and status = 'active';
    return jsonb_build_object('removed', true);
  elsif p_mode = 'restore' then
    if k.status = 'removed' then
      if exists (select 1 from memory.cards x join memory.passages y on y.id = x.passage_id
                  where x.profile_id = v_uid and x.status = 'active' and x.id <> k.id
                    and y.ref_key = (select ref_key from memory.passages where id = k.passage_id)) then
        raise exception 'You''re practicing another text of this verse. Remove that one first.' using errcode = '22023';
      end if;
      update memory.cards set status = 'active', removed_at = null, updated_at = now() where id = k.id;
    end if;
    return jsonb_build_object('restored', true);
  elsif p_mode = 'delete' then
    if p_confirm is distinct from 'delete' then
      raise exception 'Confirm that you want to delete this verse and its practice history.' using errcode = '22023';
    end if;
    delete from memory.cards where id = k.id;
    return jsonb_build_object('deleted', true);
  end if;
  raise exception 'Unknown action.' using errcode = '22023';
end;
$$;

-- The member's explicit decision to practice the updated text. The earlier
-- card (and its history) is kept as "earlier text"; the new card starts
-- fresh, because practice of one wording isn't practice of another.
create function public.memory_card_switch_version(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
  p memory.passages;
  i memory.items;
  v_new uuid;
  n memory.cards;
begin
  select * into k from memory.cards where id = p_id and profile_id = v_uid and status = 'active' for update;
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  if k.item_id is not null then
    select * into i from memory.items where id = k.item_id and retired_at is null;
  end if;
  if i.id is not null and i.passage_id <> k.passage_id and memory.collection_visible_id(i.collection_id, v_uid) then
    v_new := i.passage_id;
  elsif p.superseded_by is not null or not memory.passage_current(p) then
    v_new := memory.capture_passage(p.translation_id, p.book_code, p.start_chapter, p.start_verse, p.end_chapter, p.end_verse);
  end if;
  if v_new is null or v_new = k.passage_id then
    raise exception 'This verse already uses the current text.' using errcode = '22023';
  end if;
  update memory.cards set status = 'superseded', removed_at = now(), updated_at = now() where id = k.id;
  insert into memory.cards (profile_id, passage_id, item_id, due_on, previous_card_id)
  values (v_uid, v_new, k.item_id, memory.local_today(memory.member_tz(v_uid)), k.id)
  on conflict (profile_id, passage_id) do update
    set status = 'active', removed_at = null, previous_card_id = excluded.previous_card_id, updated_at = now()
  returning * into n;
  return memory.card_json(n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Practice sessions
-- ---------------------------------------------------------------------------
-- The setup the member sees (never the hidden answers).
create function memory.public_setup(x memory.sessions, p memory.passages)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_blanks integer[];
  v_label text;
  v_segments jsonb := case when x.short_segments then p.short_segments else p.segments end;
begin
  v_label := case when x.segment = 0 then p.label
                  else coalesce((select s ->> 'label' from jsonb_array_elements(v_segments) s where (s ->> 'n')::integer = x.segment), p.label) end;
  case x.activity
    when 'read_repeat' then
      return jsonb_build_object('tokens', (select jsonb_agg(jsonb_build_object('i', n - 1, 't', e ->> 't', 'g', (e ->> 'g')::boolean, 'b', coalesce((e ->> 'b')::boolean, false),
                                                                              'v', e ->> 'v', 'c', e ->> 'c', 'w', memory.word_key(e ->> 't', true, true) <> '') order by n)
                                             from jsonb_array_elements(p.tokens) with ordinality q(e, n) where n - 1 between x.token_from and x.token_to));
    when 'flashcards' then
      return jsonb_build_object('direction', x.setup ->> 'direction',
        'front', case when x.setup ->> 'direction' = 'text_to_ref' then memory.range_text(p.tokens, x.token_from, x.token_to) else v_label end);
    when 'self_check' then
      return jsonb_build_object('hint_count', x.hints);
    when 'type_verse' then
      return jsonb_build_object('words', (select count(*) from memory.words(p.tokens, x.token_from, x.token_to, true, true)),
        'ignore_case', (x.setup ->> 'ignore_case')::boolean, 'ignore_punctuation', (x.setup ->> 'ignore_punct')::boolean);
    when 'missing_words' then
      select array_agg(b::integer) into v_blanks from jsonb_array_elements_text(x.setup -> 'blanks') b;
      return jsonb_build_object(
        'typed', (x.setup ->> 'typed')::boolean,
        'blank_count', cardinality(v_blanks),
        'tokens', (select jsonb_agg(case when n - 1 = any(v_blanks)
                                         then jsonb_build_object('i', n - 1, 'blank', array_position(v_blanks, (n - 1)::integer),
                                                                 'pre', memory.token_core(e ->> 't') ->> 'pre', 'post', memory.token_core(e ->> 't') ->> 'post',
                                                                 'g', (e ->> 'g')::boolean, 'b', coalesce((e ->> 'b')::boolean, false))
                                         else jsonb_build_object('i', n - 1, 't', e ->> 't', 'g', (e ->> 'g')::boolean, 'b', coalesce((e ->> 'b')::boolean, false)) end order by n)
                     from jsonb_array_elements(p.tokens) with ordinality q(e, n) where n - 1 between x.token_from and x.token_to),
        'bank', x.setup -> 'bank');
    when 'word_order' then
      return jsonb_build_object('chips', (select jsonb_agg(jsonb_build_object('id', c ->> 'id', 'text', memory.range_text(p.tokens, (c ->> 'from')::integer, (c ->> 'to')::integer))
                                                           order by memory.rank(x.id, (c ->> 'from')::integer))
                                            from jsonb_array_elements(x.setup -> 'chips') c));
  end case;
  return '{}'::jsonb;
end;
$$;

create function memory.session_json(x memory.sessions)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p memory.passages;
  v_segments jsonb;
begin
  select * into p from memory.passages where id = x.passage_id;
  v_segments := case when x.short_segments then p.short_segments else p.segments end;
  return jsonb_build_object(
    'id', x.id, 'card_id', x.card_id, 'activity', x.activity, 'difficulty', x.difficulty, 'segment', x.segment,
    'segment_count', jsonb_array_length(v_segments), 'short_segments', x.short_segments,
    'label', case when x.segment = 0 then p.label
                  else coalesce((select s ->> 'label' from jsonb_array_elements(v_segments) s where (s ->> 'n')::integer = x.segment), p.label) end,
    'reference', p.label, 'hints', x.hints, 'revealed', x.revealed, 'status', x.status, 'expires_at', x.expires_at,
    'translation', (select jsonb_build_object('code', t.code, 'name', t.name, 'attribution', t.attribution, 'copyright', t.copyright,
                                              'source_url', t.source_url, 'allow_copy', t.allow_copy, 'allow_print', t.allow_print)
                      from bible.translations t where t.id = p.translation_id),
    'setup', memory.public_setup(x, p),
    'result', x.result);
end;
$$;

-- Builds the server's choices for a session (also used by the staff preview).
create function memory.build_setup(p_id uuid, p memory.passages, p_activity memory.activity, p_difficulty memory.difficulty,
                                   p_from integer, p_to integer, p_step integer, s memory.member_settings, p_options jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_words integer;
  v_count integer;
  v_rate numeric;
  v_blanks integer[];
  v_bank jsonb;
  v_size integer;
  v_chips jsonb;
begin
  select count(*) into v_words from memory.words(p.tokens, p_from, p_to, true, true);
  case p_activity
    when 'flashcards' then
      return jsonb_build_object('direction', case when p_options ->> 'direction' = 'text_to_ref' then 'text_to_ref' else 'ref_to_text' end);
    when 'type_verse' then
      return jsonb_build_object('ignore_case', coalesce((p_options ->> 'ignore_case')::boolean, s.ignore_case),
                                'ignore_punct', coalesce((p_options ->> 'ignore_punctuation')::boolean, s.ignore_punctuation));
    when 'missing_words' then
      v_rate := case p_difficulty when 'guided' then 0.15 when 'growing' then 0.30 else 0.45 end + 0.05 * least(greatest(p_step, 0), 4);
      v_count := least(greatest(round(v_words * v_rate)::integer, 1), 12, v_words);
      -- Prefer words of three or more letters; fill from the rest if needed.
      select array_agg(w.idx order by w.idx) into v_blanks from (
        select w.idx from memory.words(p.tokens, p_from, p_to, true, true) w
         order by char_length(w.k) < 3, memory.rank(p_id, w.idx) limit v_count) w;
      if p_difficulty <> 'challenge' then
        -- One choice per distinct word (a repeated word shows its count, so
        -- no two choices are interchangeable); Growing adds up to three
        -- other words from the passage that don't match any blank.
        select jsonb_agg(jsonb_build_object('text', b.core, 'count', b.n) order by b.k) into v_bank from (
          select memory.word_key(e ->> 't', true, true) as k,
                 min(memory.token_core(e ->> 't') ->> 'core') as core, count(*) as n
            from unnest(v_blanks) bi(idx) cross join lateral (select p.tokens -> bi.idx as e) q
           group by 1
          union all
          select d.k, d.core, 0 from (
            select distinct on (w.k) w.k, memory.token_core(w.t) ->> 'core' as core, memory.rank(p_id, w.idx + 10000) as r
              from memory.words(p.tokens, 0, jsonb_array_length(p.tokens) - 1, true, true) w
             where p_difficulty = 'growing' and char_length(w.k) >= 3
               and w.k not in (select memory.word_key(p.tokens -> bi.idx ->> 't', true, true) from unnest(v_blanks) bi(idx))
             order by w.k, r) d
           order by 3 desc, 1 limit 50) b;
        -- Keep every answer and at most three distractors.
        -- Distractors look exactly like answers (no count), so the list
        -- never reveals which words are hidden.
        select jsonb_agg(jsonb_build_object('text', e ->> 'text')
                         || case when (e ->> 'count')::integer > 1 then jsonb_build_object('count', (e ->> 'count')::integer) else '{}'::jsonb end
                         order by lower(e ->> 'text'), e ->> 'text') into v_bank from (
          select e from jsonb_array_elements(v_bank) e where (e ->> 'count')::integer > 0
          union all
          (select e from jsonb_array_elements(v_bank) e where (e ->> 'count')::integer = 0 order by memory.rank(p_id, char_length(e ->> 'text')), e ->> 'text' limit 3)) z;
      end if;
      return jsonb_build_object('blanks', to_jsonb(v_blanks), 'typed', p_difficulty = 'challenge',
                                'ignore_case', s.ignore_case, 'bank', v_bank, 'hinted', '[]'::jsonb);
    when 'word_order' then
      -- Phrases of 4 words (Guided), pairs (Growing), or single words
      -- (Challenge), with at most 24 pieces.
      v_size := greatest(case p_difficulty when 'guided' then 4 when 'growing' then 2 else 1 end, ceil(v_words / 24.0)::integer);
      select jsonb_agg(jsonb_build_object('id', substr(md5(p_id::text || ':' || g.first), 1, 10), 'from', g.first, 'to', g.last) order by g.first)
        into v_chips
        from (select min(w.idx) as first, max(w.idx) as last
                from (select w.idx, (row_number() over (order by w.idx) - 1) / v_size as grp
                        from memory.words(p.tokens, p_from, p_to, true, true) w) w
               group by w.grp) g;
      -- Punctuation-only tokens between words stay with the chip before them.
      select jsonb_agg(z.c || jsonb_build_object('to', coalesce(z.next_from - 1, p_to)) order by z.f) into v_chips
        from (select c, (c ->> 'from')::integer as f, lead((c ->> 'from')::integer) over (order by (c ->> 'from')::integer) as next_from
                from jsonb_array_elements(v_chips) c) z;
      return jsonb_build_object('chips', v_chips);
    else
      return '{}'::jsonb;
  end case;
end;
$$;

-- p_segment 0 = whole passage (scored typing, word order, and missing
-- words allow it up to 80 words; longer passages use parts).
-- p_options: {direction, ignore_case, ignore_punctuation, short}
create function public.memory_session_start(p_card uuid, p_activity text, p_difficulty text, p_segment integer, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  k memory.cards;
  p memory.passages;
  s memory.member_settings := memory.settings_of(v_uid);
  v_activity memory.activity;
  v_difficulty memory.difficulty;
  v_short boolean := coalesce((p_options ->> 'short')::boolean, s.presentation = 'kids');
  v_segments jsonb;
  v_from integer;
  v_to integer;
  v_id uuid := gen_random_uuid();
  x memory.sessions;
begin
  perform community.rate_limit(v_uid, 'memory_start', 200, interval '10 minutes');
  if p_activity not in ('read_repeat', 'flashcards', 'missing_words', 'word_order', 'type_verse', 'self_check')
     or coalesce(p_difficulty, s.difficulty::text) not in ('guided', 'growing', 'challenge') then
    raise exception 'Choose an activity and difficulty.' using errcode = '22023';
  end if;
  v_activity := p_activity::memory.activity;
  v_difficulty := coalesce(p_difficulty, s.difficulty::text)::memory.difficulty;
  select * into k from memory.cards where id = p_card and profile_id = v_uid and status = 'active';
  if k.id is null then
    raise exception 'Verse not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = k.passage_id;
  if not bible.translation_active(p.translation_id) then
    raise exception 'This verse''s Bible version is no longer available for practice.' using errcode = '22023';
  end if;
  v_segments := case when v_short then p.short_segments else p.segments end;
  if coalesce(p_segment, 0) = 0 then
    if v_activity in ('missing_words', 'word_order', 'type_verse') and p.word_count > 80 then
      raise exception 'This passage is long. Practice it one part at a time.' using errcode = '22023';
    end if;
    v_from := 0;
    v_to := jsonb_array_length(p.tokens) - 1;
  else
    select (e ->> 'from')::integer, (e ->> 'to')::integer into v_from, v_to
      from jsonb_array_elements(v_segments) e where (e ->> 'n')::integer = p_segment;
    if v_from is null then
      raise exception 'That part of the passage doesn''t exist.' using errcode = '22023';
    end if;
  end if;
  if v_activity = 'word_order' and (select count(*) from memory.words(p.tokens, v_from, v_to, true, true)) < 2 then
    raise exception 'This passage is too short for word order.' using errcode = '22023';
  end if;
  insert into memory.sessions (id, profile_id, card_id, passage_id, activity, difficulty, segment, short_segments, token_from, token_to, setup)
  values (v_id, v_uid, k.id, p.id, v_activity, v_difficulty, coalesce(p_segment, 0), v_short, v_from, v_to,
          memory.build_setup(v_id, p, v_activity, v_difficulty, v_from, v_to, k.step, s, coalesce(p_options, '{}'::jsonb)))
  returning * into x;
  return memory.session_json(x);
end;
$$;

create function memory.load_session(p_id uuid, p_uid uuid)
returns memory.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  x memory.sessions;
begin
  select * into x from memory.sessions where id = p_id and profile_id = p_uid for update;
  if x.id is null then
    raise exception 'That practice activity wasn''t found.' using errcode = 'P0002';
  end if;
  if x.status = 'open' and x.expires_at <= now() then
    update memory.sessions set status = 'expired' where id = x.id returning * into x;
  end if;
  return x;
end;
$$;

-- Hints are counted here, when they're shown.
--   type_verse:    {position} → the word at that position
--   missing_words: {blank}    → that blank's word
--   word_order:    {order}    → the first misplaced or empty position and
--                                the piece that belongs there
--   self_check:    {}         → the next few opening words
create function public.memory_session_hint(p_session uuid, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  x memory.sessions;
  pa memory.passages;
  v_words text[];
  v_pos integer;
  v_idx integer;
  v_hint jsonb;
  v_expected text[];
  v_given text[];
  v_chip text;
  i integer;
begin
  perform community.rate_limit(v_uid, 'memory_hint', 300, interval '10 minutes');
  x := memory.load_session(p_session, v_uid);
  if x.status <> 'open' then
    return jsonb_build_object('status', x.status);
  end if;
  select * into pa from memory.passages where id = x.passage_id;
  select array_agg(w.t order by w.idx) into v_words from memory.words(pa.tokens, x.token_from, x.token_to, true, true) w;
  case x.activity
    when 'type_verse' then
      v_pos := least(greatest(coalesce((p ->> 'position')::integer, 0), 0), cardinality(v_words) - 1);
      v_hint := jsonb_build_object('position', v_pos, 'word', v_words[v_pos + 1]);
    when 'missing_words' then
      v_pos := (p ->> 'blank')::integer;
      v_idx := (x.setup -> 'blanks' ->> (v_pos - 1))::integer;
      if v_idx is null then
        raise exception 'Choose a blank.' using errcode = '22023';
      end if;
      v_hint := jsonb_build_object('blank', v_pos, 'word', memory.token_core(pa.tokens -> v_idx ->> 't') ->> 'core');
      update memory.sessions set setup = jsonb_set(setup, '{hinted}', (setup -> 'hinted') || to_jsonb(v_pos)) where id = x.id;
    when 'word_order' then
      select array_agg(memory.chip_key(pa.tokens, c) order by (c ->> 'from')::integer) into v_expected from jsonb_array_elements(x.setup -> 'chips') c;
      select array_agg(coalesce(memory.chip_key(pa.tokens, (select c from jsonb_array_elements(x.setup -> 'chips') c where c ->> 'id' = o.v)), '') order by o.n)
        into v_given from jsonb_array_elements_text(coalesce(p -> 'order', '[]'::jsonb)) with ordinality o(v, n);
      v_pos := cardinality(v_expected);
      for i in 1 .. cardinality(v_expected) loop
        if v_given is null or i > cardinality(v_given) or v_given[i] is distinct from v_expected[i] then
          v_pos := i;
          exit;
        end if;
      end loop;
      -- The piece that belongs there and isn't already correctly placed.
      select c ->> 'id' into v_chip from jsonb_array_elements(x.setup -> 'chips') c
       where memory.chip_key(pa.tokens, c) = v_expected[v_pos]
       order by (c ->> 'id') = any(coalesce((select array_agg(o.v) from jsonb_array_elements_text(coalesce(p -> 'order', '[]'::jsonb)) with ordinality o(v, n) where o.n < v_pos), '{}')),
                (c ->> 'from')::integer
       limit 1;
      v_hint := jsonb_build_object('position', v_pos, 'id', v_chip);
    when 'self_check' then
      v_hint := jsonb_build_object('words', array_to_string(v_words[1:least(3 * (x.hints + 1), cardinality(v_words))], ' '),
                                   'more', 3 * (x.hints + 1) < cardinality(v_words));
    else
      raise exception 'This activity has no hints.' using errcode = '22023';
  end case;
  update memory.sessions set hints = hints + 1 where id = x.id;
  return v_hint || jsonb_build_object('hints', x.hints + 1);
end;
$$;

-- Self-check and flashcards: the hidden side, only when asked for.
create function public.memory_session_reveal(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  x memory.sessions;
  pa memory.passages;
begin
  x := memory.load_session(p_session, v_uid);
  if x.activity not in ('self_check', 'flashcards') then
    raise exception 'This activity has nothing to reveal.' using errcode = '22023';
  end if;
  if x.status = 'expired' then
    return jsonb_build_object('status', x.status);
  end if;
  select * into pa from memory.passages where id = x.passage_id;
  update memory.sessions set revealed = true where id = x.id;
  return jsonb_build_object('status', x.status, 'reference', pa.label,
    'text', case when x.activity = 'flashcards' and x.setup ->> 'direction' = 'text_to_ref' then null
                 else memory.range_text(pa.tokens, x.token_from, x.token_to) end,
    'verses', (select jsonb_agg(distinct (e ->> 'v')::integer) from jsonb_array_elements(pa.tokens) with ordinality q(e, n)
                where n - 1 between x.token_from and x.token_to));
end;
$$;

-- Awards a badge once; returns it when new.
create function memory.award(p_profile uuid, p_badge text, p_scope text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean;
begin
  insert into memory.awards (profile_id, badge_key, scope) values (p_profile, p_badge, coalesce(p_scope, ''))
  on conflict do nothing
  returning true into v_new;
  if v_new then
    return (select jsonb_build_object('key', b.key, 'name', b.name, 'description', b.description) from memory.badges b where b.key = p_badge);
  end if;
  return null;
end;
$$;

-- Submit once. Retries of a submitted session return the stored result;
-- expired sessions and cards removed or replaced since the start return a
-- status instead of recording anything.
--   read_repeat:   {level, reveals}
--   flashcards:    {confidence}   (after reveal)
--   self_check:    {confidence}   (after reveal)
--   missing_words: {answers: {"<token index>": "word"}, confidence?}
--   word_order:    {order: [piece ids], confidence?}
--   type_verse:    {text, confidence?}
create function public.memory_session_submit(p_session uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  x memory.sessions;
  k memory.cards;
  pa memory.passages;
  s memory.member_settings := memory.settings_of(v_uid);
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
  v_badges jsonb := '[]'::jsonb;
  v_badge jsonb;
  v_result jsonb;
  v_attempts integer;
  v_days integer;
  v_item memory.items;
  v_verses integer[];
  v_step_before integer;
begin
  perform community.rate_limit(v_uid, 'memory_submit', 120, interval '10 minutes');
  x := memory.load_session(p_session, v_uid);
  if x.status = 'submitted' then
    return x.result || jsonb_build_object('replayed', true);
  end if;
  if x.status = 'expired' then
    return jsonb_build_object('status', 'expired', 'saved', false);
  end if;
  select * into k from memory.cards where id = x.card_id and profile_id = v_uid for update;
  if k.id is null or k.status <> 'active' or k.passage_id <> x.passage_id then
    return jsonb_build_object('status', 'conflict', 'saved', false);
  end if;
  select * into pa from memory.passages where id = x.passage_id;
  if v_conf is not null and v_conf not in ('not_yet', 'partly', 'mostly', 'fully') then
    raise exception 'Choose how well you knew it.' using errcode = '22023';
  end if;
  v_hints := x.hints;
  case x.activity
    when 'read_repeat' then
      v_hints := v_hints + least(greatest(coalesce((p ->> 'reveals')::integer, 0), 0), 500);
      v_details := jsonb_build_object('level', least(greatest(coalesce((p ->> 'level')::integer, 0), 0), 3));
    when 'flashcards', 'self_check' then
      if not x.revealed then
        raise exception 'Reveal the verse before checking yourself.' using errcode = '22023';
      end if;
      if v_conf is null then
        raise exception 'Choose how well you knew it.' using errcode = '22023';
      end if;
    when 'missing_words' then
      v_details := memory.score_blanks(pa.tokens, (select array_agg(b::integer) from jsonb_array_elements_text(x.setup -> 'blanks') b),
                                       coalesce(p -> 'answers', '{}'::jsonb), coalesce((x.setup ->> 'ignore_case')::boolean, true));
      v_accuracy := (v_details ->> 'accuracy')::numeric;
    when 'word_order' then
      v_details := memory.score_order(pa.tokens, x.setup -> 'chips', p -> 'order');
      v_accuracy := (v_details ->> 'accuracy')::numeric;
    when 'type_verse' then
      select array_agg(distinct (e ->> 'v')::integer) into v_verses
        from jsonb_array_elements(pa.tokens) with ordinality q(e, n) where n - 1 between x.token_from and x.token_to;
      v_details := memory.score_typed(pa.tokens, x.token_from, x.token_to, p ->> 'text',
                                      (x.setup ->> 'ignore_case')::boolean, (x.setup ->> 'ignore_punct')::boolean,
                                      (select b.name from bible.books b where b.code = pa.book_code), v_verses)
                   || jsonb_build_object('your_text', left(coalesce(p ->> 'text', ''), 20000),
                                         'text', memory.range_text(pa.tokens, x.token_from, x.token_to),
                                         'ignore_case', (x.setup ->> 'ignore_case')::boolean, 'ignore_punctuation', (x.setup ->> 'ignore_punct')::boolean);
      v_accuracy := (v_details ->> 'accuracy')::numeric;
  end case;

  v_quality := memory.quality_of(x.activity, v_accuracy, v_hints, v_conf);
  v_recall := memory.is_recall(x.activity, x.difficulty);
  v_step_before := k.step;
  v_step := k.step;
  v_due := k.due_on;
  v_was_due := k.due_on is null or k.due_on <= v_today;
  -- The schedule changes at most once per verse per day.
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

  update memory.cards set
    step = v_step, due_on = v_due, best_step = greatest(best_step, v_step),
    last_scheduled_on = case when v_change in ('advanced', 'kept', 'eased') then v_today else last_scheduled_on end,
    sessions = sessions + 1, last_practiced_at = now(), updated_at = now()
  where id = k.id
  returning * into k;

  insert into memory.attempts (session_id, card_id, profile_id, passage_id, activity, difficulty, segment, completed, accuracy, hints,
                               confidence, quality, step_before, step_after, local_date)
  values (x.id, k.id, v_uid, pa.id, x.activity, x.difficulty, x.segment, true, v_accuracy, v_hints, v_conf, v_quality,
          v_step_before, v_step, v_today);

  -- Badges (effort and milestones only; computed here, never accepted from
  -- the client).
  select count(*), count(distinct local_date) into v_attempts, v_days from memory.attempts where profile_id = v_uid and completed;
  for v_badge in
    select memory.award(v_uid, b) from unnest(array_remove(array[
      case when v_attempts >= 1 then 'first_steps' end,
      case when v_attempts >= 10 then 'steady_ten' end,
      case when v_attempts >= 50 then 'faithful_fifty' end,
      case when v_days >= 3 then 'coming_back' end,
      case when v_days >= 10 then 'ten_days' end,
      case when (x.activity = 'self_check' and v_conf = 'fully') or (x.activity = 'type_verse' and v_accuracy >= 1 and v_hints = 0) then 'recited' end,
      case when k.best_step >= 3 then 'taking_root' end,
      case when (select count(*) from memory.cards c where c.profile_id = v_uid and c.best_step >= 3) >= 5 then 'treasured_five' end,
      case when (select count(distinct activity) from memory.attempts a where a.profile_id = v_uid) = 6 then 'explorer' end], null)) b
  loop
    if v_badge is not null then
      v_badges := v_badges || jsonb_build_array(v_badge);
    end if;
  end loop;
  if k.item_id is not null then
    select * into v_item from memory.items where id = k.item_id;
    if not exists (select 1 from memory.items i where i.collection_id = v_item.collection_id and i.retired_at is null
                      and not exists (select 1 from memory.cards c where c.profile_id = v_uid and c.sessions > 0
                                         and (c.item_id = i.id or c.passage_id = i.passage_id))) then
      v_badge := memory.award(v_uid, 'collection_explored', v_item.collection_id::text);
      if v_badge is not null then
        v_badges := v_badges || jsonb_build_array(v_badge || jsonb_build_object('collection',
                      (select c.title from memory.collections c where c.id = v_item.collection_id)));
      end if;
    end if;
  end if;

  v_result := jsonb_build_object(
    'status', 'saved', 'saved', true, 'session_id', x.id, 'card_id', k.id, 'activity', x.activity, 'difficulty', x.difficulty,
    'completed', true, 'accuracy', v_accuracy, 'hints', v_hints, 'confidence', v_conf, 'quality', v_quality,
    'recall', v_recall, 'details', v_details,
    'review', jsonb_build_object('change', v_change, 'step', k.step, 'stage', memory.stage(k.step), 'due_on', k.due_on,
                                 'review_ready', k.best_step >= 3),
    'badges', v_badges, 'done_today', (select count(*) from memory.attempts a where a.profile_id = v_uid and a.local_date = v_today),
    'daily_goal', s.daily_goal, 'celebrations', s.celebrations);
  update memory.sessions set status = 'submitted', submitted_at = now(), result = v_result where id = x.id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review queue, progress, settings
-- ---------------------------------------------------------------------------
create function public.memory_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  s memory.member_settings := memory.settings_of(v_uid);
  v_today date := memory.local_today(memory.member_tz(v_uid));
begin
  return jsonb_build_object(
    'today', v_today, 'timezone', memory.member_tz(v_uid), 'paused', s.paused, 'daily_goal', s.daily_goal,
    'done_today', (select count(*) from memory.attempts a where a.profile_id = v_uid and a.local_date = v_today),
    'due', coalesce((select jsonb_agg(memory.card_json(k) order by k.due_on nulls first, k.step, k.added_at)
                       from memory.cards k join memory.passages p on p.id = k.passage_id
                      where k.profile_id = v_uid and k.status = 'active' and bible.translation_active(p.translation_id)
                        and (k.due_on is null or k.due_on <= v_today)), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('date', d.due_on, 'cards', d.cards) order by d.due_on)
                            from (select k.due_on, jsonb_agg(memory.card_json(k) order by k.added_at) as cards
                                    from memory.cards k
                                   where k.profile_id = v_uid and k.status = 'active' and k.due_on > v_today and k.due_on <= v_today + 14
                                   group by k.due_on) d), '[]'::jsonb),
    'later', (select count(*) from memory.cards k where k.profile_id = v_uid and k.status = 'active' and k.due_on > v_today + 14));
end;
$$;

create function public.memory_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  v_today date := memory.local_today(memory.member_tz(v_uid));
begin
  return jsonb_build_object(
    'today', v_today,
    'verses_practiced', (select count(*) from memory.cards k where k.profile_id = v_uid and k.status = 'active' and k.sessions > 0),
    'verses', (select count(*) from memory.cards k where k.profile_id = v_uid and k.status = 'active'),
    'stages', (select jsonb_object_agg(st, n) from (
                 select memory.stage(k.step) as st, count(*) as n from memory.cards k
                  where k.profile_id = v_uid and k.status = 'active' group by 1) x),
    'review_ready', (select count(*) from memory.cards k where k.profile_id = v_uid and k.status = 'active' and k.best_step >= 3),
    'sessions', (select count(*) from memory.attempts a where a.profile_id = v_uid),
    'sessions_7', (select count(*) from memory.attempts a where a.profile_id = v_uid and a.local_date > v_today - 7),
    'days_28', coalesce((select jsonb_agg(d order by d) from (select distinct a.local_date as d from memory.attempts a
                                                              where a.profile_id = v_uid and a.local_date > v_today - 28) x), '[]'::jsonb),
    'activities', coalesce((select jsonb_object_agg(a.activity, a.n) from (select activity, count(*) as n from memory.attempts
                                                                          where profile_id = v_uid group by 1) a), '{}'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'items', x.items, 'practiced', x.practiced,
                                                                 'review_ready', x.ready) order by c.sort_order, c.title)
                               from memory.collections c
                               cross join lateral (
                                 select count(*) as items,
                                        count(*) filter (where (memory.my_card_for_item(i, v_uid)).sessions > 0) as practiced,
                                        count(*) filter (where (memory.my_card_for_item(i, v_uid)).best_step >= 3) as ready
                                   from memory.items i where i.collection_id = c.id and i.retired_at is null) x
                              where memory.collection_visible(c, v_uid) and x.practiced > 0), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('key', b.key, 'name', b.name, 'description', b.description,
                                                            'earned', a.awarded_at is not null, 'awarded_at', a.awarded_at,
                                                            'times', a.n) order by b.sort_order)
                          from memory.badges b
                          left join (select badge_key, min(awarded_at) as awarded_at, count(*) as n from memory.awards
                                      where profile_id = v_uid group by 1) a on a.badge_key = b.key), '[]'::jsonb));
end;
$$;

create function public.memory_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  return memory.settings_json(memory.settings_of(v_uid)) || jsonb_build_object(
    'notifications', (select jsonb_build_object('in_app', x.in_app, 'email', x.email, 'push', x.push)
                        from community.pref(v_uid, 'memory') x));
end;
$$;

create function public.memory_settings_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  s memory.member_settings := memory.settings_of(v_uid);
begin
  if p ? 'difficulty' and p ->> 'difficulty' not in ('guided', 'growing', 'challenge') then
    raise exception 'Choose a difficulty.' using errcode = '22023';
  end if;
  if p ? 'presentation' and p ->> 'presentation' not in ('standard', 'kids') then
    raise exception 'Choose a presentation.' using errcode = '22023';
  end if;
  if p ? 'daily_goal' and nullif(p ->> 'daily_goal', '') is not null and (p ->> 'daily_goal')::integer not between 1 and 20 then
    raise exception 'Choose a daily goal from 1 to 20, or none.' using errcode = '22023';
  end if;
  if p ? 'timezone' and nullif(p ->> 'timezone', '') is not null and not memory.valid_tz(p ->> 'timezone') then
    raise exception 'Choose a valid time zone.' using errcode = '22023';
  end if;
  if p ? 'reminder_time' and (p ->> 'reminder_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Choose a reminder time.' using errcode = '22023';
  end if;
  insert into memory.member_settings as m (profile_id, difficulty, presentation, ignore_case, ignore_punctuation, celebrations, daily_goal,
                                           timezone, paused, remind_weekly, remind_review, remind_practice, remind_challenge, reminder_time)
  values (v_uid,
          coalesce(p ->> 'difficulty', s.difficulty::text)::memory.difficulty,
          coalesce(p ->> 'presentation', s.presentation),
          coalesce((p ->> 'ignore_case')::boolean, s.ignore_case),
          coalesce((p ->> 'ignore_punctuation')::boolean, s.ignore_punctuation),
          coalesce((p ->> 'celebrations')::boolean, s.celebrations),
          case when p ? 'daily_goal' then nullif(p ->> 'daily_goal', '')::smallint else s.daily_goal end,
          case when p ? 'timezone' then nullif(p ->> 'timezone', '') else s.timezone end,
          coalesce((p ->> 'paused')::boolean, s.paused),
          coalesce((p ->> 'remind_weekly')::boolean, s.remind_weekly),
          coalesce((p ->> 'remind_review')::boolean, s.remind_review),
          coalesce((p ->> 'remind_practice')::boolean, s.remind_practice),
          coalesce((p ->> 'remind_challenge')::boolean, s.remind_challenge),
          coalesce((p ->> 'reminder_time')::time, s.reminder_time))
  on conflict (profile_id) do update set
    difficulty = excluded.difficulty, presentation = excluded.presentation, ignore_case = excluded.ignore_case,
    ignore_punctuation = excluded.ignore_punctuation, celebrations = excluded.celebrations, daily_goal = excluded.daily_goal,
    timezone = excluded.timezone, paused = excluded.paused, remind_weekly = excluded.remind_weekly,
    remind_review = excluded.remind_review, remind_practice = excluded.remind_practice,
    remind_challenge = excluded.remind_challenge, reminder_time = excluded.reminder_time, updated_at = now();
  return memory.settings_json(memory.settings_of(v_uid));
end;
$$;

-- The member's own practice data. Scripture text is included only where the
-- translation allows export; references and results are always included.
create function public.memory_export()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'settings', memory.settings_json(memory.settings_of(v_uid)),
    'verses', coalesce((select jsonb_agg(jsonb_build_object(
                         'reference', p.label, 'translation', t.code, 'text_version', p.version, 'status', k.status,
                         'stage', memory.stage(k.step), 'step', k.step, 'next_review', k.due_on, 'sessions', k.sessions,
                         'added_at', k.added_at,
                         'text', case when t.allow_export then (select string_agg(e ->> 't', ' ') from jsonb_array_elements(p.verses) e) end,
                         'attempts', coalesce((select jsonb_agg(jsonb_build_object('date', a.local_date, 'activity', a.activity, 'difficulty', a.difficulty,
                                                                                   'accuracy', a.accuracy, 'hints', a.hints, 'confidence', a.confidence,
                                                                                   'result', a.quality) order by a.created_at)
                                                 from memory.attempts a where a.card_id = k.id), '[]'::jsonb)) order by k.added_at)
                         from memory.cards k join memory.passages p on p.id = k.passage_id join bible.translations t on t.id = p.translation_id
                        where k.profile_id = v_uid), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('badge', b.name, 'awarded_at', a.awarded_at) order by a.awarded_at)
                          from memory.awards a join memory.badges b on b.key = a.badge_key where a.profile_id = v_uid), '[]'::jsonb),
    'personal_collections', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'description', c.description,
                                        'verses', (select jsonb_agg(p.label order by i.position) from memory.items i join memory.passages p on p.id = i.passage_id
                                                    where i.collection_id = c.id and i.retired_at is null)))
                                        from memory.collections c where c.audience = 'personal' and c.owner_id = v_uid), '[]'::jsonb));
end;
$$;

-- Deletes all of the member's practice history: verses, sessions, results,
-- review schedule, and badges (p_confirm must be 'delete my practice
-- history'). Challenge contributions disappear with it, because group
-- totals are counted live from results. Personal collections are deleted
-- only when p_collections is true. Settings are kept.
create function public.memory_history_delete(p_confirm text, p_collections boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  v_cards integer;
begin
  if p_confirm is distinct from 'delete my practice history' then
    raise exception 'Type the confirmation exactly to delete your practice history.' using errcode = '22023';
  end if;
  delete from memory.cards where profile_id = v_uid;
  get diagnostics v_cards = row_count;
  delete from memory.sessions where profile_id = v_uid;
  delete from memory.awards where profile_id = v_uid;
  if p_collections then
    delete from memory.collections where audience = 'personal' and owner_id = v_uid;
  end if;
  update memory.member_settings set last_review_on = null, last_practice_on = null, updated_at = now() where profile_id = v_uid;
  return jsonb_build_object('deleted', true, 'verses', v_cards);
end;
$$;

-- ---------------------------------------------------------------------------
-- Personal collections (owner only)
-- ---------------------------------------------------------------------------
create function public.memory_my_collection_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections;
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_translation uuid := nullif(p ->> 'translation_id', '')::uuid;
begin
  perform community.rate_limit(v_uid, 'memory_card', 120, interval '10 minutes');
  if char_length(v_title) not between 1 and 120 or char_length(coalesce(p ->> 'description', '')) > 2000 then
    raise exception 'Give the collection a title (up to 120 characters).' using errcode = '22023';
  end if;
  if p_id is null then
    if (select count(*) from memory.collections where audience = 'personal' and owner_id = v_uid) >= 50 then
      raise exception 'You can keep up to 50 personal collections.' using errcode = '22023';
    end if;
    v_translation := coalesce(v_translation, (select s.default_translation_id from bible.settings s));
    if not exists (select 1 from bible.translations t where t.id = v_translation and t.status = 'active' and t.source_kind = 'database') then
      raise exception 'Choose an available Bible version.' using errcode = '22023';
    end if;
    insert into memory.collections (title, description, audience, owner_id, translation_id, status, publish_at, created_by, updated_by)
    values (v_title, coalesce(p ->> 'description', ''), 'personal', v_uid, v_translation, 'published', now(), v_uid, v_uid)
    returning * into c;
  else
    update memory.collections set title = v_title, description = coalesce(p ->> 'description', description), updated_at = now()
     where id = p_id and audience = 'personal' and owner_id = v_uid
    returning * into c;
    if c.id is null then
      raise exception 'Collection not found.' using errcode = 'P0002';
    end if;
  end if;
  return memory.collection_json(c);
end;
$$;

-- Adds one of the member's verses (same Bible version) to their collection.
create function public.memory_my_collection_add(p_collection uuid, p_card uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  c memory.collections;
  k memory.cards;
  i memory.items;
begin
  select * into c from memory.collections where id = p_collection and audience = 'personal' and owner_id = v_uid;
  select * into k from memory.cards where id = p_card and profile_id = v_uid;
  if c.id is null or k.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if (select translation_id from memory.passages where id = k.passage_id) <> c.translation_id then
    raise exception 'This collection uses a different Bible version. Versions are never mixed in one collection.' using errcode = '22023';
  end if;
  select * into i from memory.items where collection_id = c.id and passage_id = k.passage_id and retired_at is null;
  if i.id is null then
    insert into memory.items (collection_id, passage_id, position)
    values (c.id, k.passage_id, coalesce((select max(position) from memory.items where collection_id = c.id and retired_at is null), 0) + 1)
    returning * into i;
  end if;
  return memory.item_json(i, false);
end;
$$;

create function public.memory_my_collection_remove(p_item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
begin
  select x.* into i from memory.items x join memory.collections c on c.id = x.collection_id
   where x.id = p_item and c.audience = 'personal' and c.owner_id = v_uid;
  if i.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  update memory.cards set item_id = null where item_id = i.id and profile_id = v_uid;
  delete from memory.items where id = i.id;
  update memory.items set position = position - 1 where collection_id = i.collection_id and retired_at is null and position > i.position;
end;
$$;

create function public.memory_my_collection_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
begin
  update memory.cards set item_id = null
   where profile_id = v_uid and item_id in (select i.id from memory.items i join memory.collections c on c.id = i.collection_id
                                             where c.id = p_id and c.audience = 'personal' and c.owner_id = v_uid);
  delete from memory.collections where id = p_id and audience = 'personal' and owner_id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff preview: the same setups and scoring, nothing recorded.
-- ---------------------------------------------------------------------------
create function public.memory_admin_preview(p_item uuid, p_activity text, p_difficulty text, p_segment integer, p_short boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := memory.require_member();
  i memory.items;
  c memory.collections;
  p memory.passages;
  v_id uuid := gen_random_uuid();
  x memory.sessions;
  v_segments jsonb;
begin
  select * into i from memory.items where id = p_item;
  select * into c from memory.collections where id = i.collection_id;
  if c.id is null or not memory.can_edit(c) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into p from memory.passages where id = i.passage_id;
  v_segments := case when p_short then p.short_segments else p.segments end;
  x.id := v_id;
  x.passage_id := p.id;
  x.card_id := null;
  x.activity := p_activity::memory.activity;
  x.difficulty := p_difficulty::memory.difficulty;
  x.segment := coalesce(p_segment, 0);
  x.short_segments := coalesce(p_short, false);
  x.hints := 0;
  x.revealed := false;
  x.status := 'open';
  if x.segment = 0 then
    x.token_from := 0;
    x.token_to := jsonb_array_length(p.tokens) - 1;
  else
    select (e ->> 'from')::integer, (e ->> 'to')::integer into x.token_from, x.token_to
      from jsonb_array_elements(v_segments) e where (e ->> 'n')::integer = x.segment;
    if x.token_from is null then
      raise exception 'That part of the passage doesn''t exist.' using errcode = '22023';
    end if;
  end if;
  x.setup := memory.build_setup(v_id, p, x.activity, x.difficulty, x.token_from, x.token_to, 0, memory.settings_of(v_uid), '{}'::jsonb);
  return memory.session_json(x) || jsonb_build_object('preview', true,
    'answer_text', memory.range_text(p.tokens, x.token_from, x.token_to), 'hidden', x.setup);
end;
$$;

revoke execute on all functions in schema memory from public, anon, authenticated;
do $grants$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'memory\_%'
              and p.proname not in ('memory_can_read_object', 'memory_can_write_object') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end
$grants$;
