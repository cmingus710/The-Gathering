-- Learn & Play games · Apply migration 20261124000100_youth_activity_games
-- to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "Learn & Play games"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Adds the Put the Story in Order and Bible Match players' database side:
-- new internal helpers in the private youth schema (executable by no API
-- role), and same-signature replacements of youth.activity_content,
-- youth.activity_detail, youth.version_json, youth.activity_object_readable,
-- public.youth_admin_activity, public.youth_admin_activity_status,
-- public.youth_admin_activity_asset_remove, and
-- public.youth_activity_progress_save (grants on replaced functions are
-- unchanged). No table, row, storage policy, or grant is added or changed.
--
-- It copies supabase/migrations/20261124000100_youth_activity_games.sql
-- verbatim and records it under its repository version (created_by =
-- youth-activity-games). All or nothing: one transaction; out of order or a
-- second run stops at the preflight with "Nothing was changed".
-- It needs the Learn & Play activities step (20261118000200) and the Bible
-- Coloring Studio step (20261123000100), whose coloring rules the replaced
-- functions keep.
begin;

do $preflight$
begin
  if to_regclass('youth.activities') is null or to_regclass('youth.activity_versions') is null
     or to_regprocedure('youth.activity_content(uuid, jsonb)') is null
     or to_regprocedure('public.youth_activity_progress_save(uuid, uuid, uuid, jsonb)') is null then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261118000200') then
    raise exception 'Nothing was changed: the Learn & Play activities step (20261118000200) is not recorded. Run the steps in order.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261123000100')
     or to_regclass('youth.coloring_artwork') is null then
    raise exception 'Nothing was changed: the Bible Coloring Studio step (20261123000100) is not applied. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124000100')
     or to_regprocedure('youth.game_config_issues(youth.activity_versions)') is not null then
    raise exception 'Nothing was changed: 20261124000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261124000100_youth_activity_games.sql
-- =========================================================================
-- Youth & Families · Learn & Play: the first two activity players.
--
-- What this adds
--   * Put the Story in Order (activity type "puzzle") and Bible Match
--     (activity type "matching"). Both are players shipped with the app; an
--     activity's version opts in with config.player ("story_order" or
--     "bible_match"). Activities without config.player keep the
--     "Mark finished" control, unchanged.
--   * Pictures in a game come either from artwork uploaded for the activity
--     (youth.activity_assets, the existing pipeline and rights record) or from
--     the app's built-in illustration library (youth.game_art_keys(), drawn in
--     src/components/youth/games/game-art.tsx). Config stores
--     {"asset": "<asset id>"} or {"art": "<key>"}, never a URL or markup.
--
-- Configuration (data only; youth.activity_json_problem still applies)
--   story_order: {player, scenes: [{id, image, caption, description, clue, note}], wrap_up}
--     scenes are listed in the correct order; at most 8.
--   bible_match: {player, mode: identical | related, sizes: [3|4|6|8|10|12],
--                 show_moves, pairs: [{id, a: {image, label, description},
--                 b: {image, label, description}, note}]}
--     b is used only for related pairs; at most 12 pairs.
--
-- Checks
--   * Saving (youth.game_config_problem): the shape, unique identifiers,
--     lengths, the activity type, and that every uploaded picture belongs to
--     this activity and is active. A draft may still be incomplete.
--   * Publishing (youth.game_config_issues): complete content. Story: a scene
--     count that fits the difficulty (Beginner 3-4, Growing 4-6, Challenge
--     5-8), a picture and caption for every scene. Match: at least 3 pairs,
--     every card has a picture (identical) or a picture or name (related), an
--     explanation for every related pair, no two cards that look alike in
--     different pairs, and board sizes the pairs can fill. The editor shows
--     the same list (version_json.issues) before anyone tries to publish.
--
-- Access
--   Unchanged rules, extended to game pictures: members may read uploaded
--   artwork used by the published version of an activity open to them (as
--   for its cover); artwork used by a published or retired version is kept;
--   artwork used by the draft can't be removed until the draft stops using it.
--
-- Builds on the Bible Coloring Studio (20261123000100): the functions it
-- replaced and this migration replaces again (activity_content,
-- youth_admin_activity, youth_admin_activity_asset_remove,
-- activity_object_readable) keep its coloring rules, its 256 KB config
-- limit, and its line-art handling. A coloring picture's line art counts as
-- a picture the version uses (config_asset_ids), like a game's.
--
-- Progress
--   Unchanged table and checks. One change to saving: once a child has
--   completed a version it stays completed when they replay it, unless the
--   save asks to reset (the "Mark not finished" control). So "Play again"
--   never erases a completion.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Keep in step with GAME_ART in src/lib/youth/games/art.ts (a unit test checks).
create function youth.game_art_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['ark', 'animals', 'rain', 'dove', 'rainbow', 'crowd', 'loaves_fish', 'thanks', 'baskets', 'fish',
               'bread', 'star', 'sling', 'tablets', 'big_fish', 'person', 'lamb', 'crown', 'lamp', 'sheep']::text[];
$$;

-- "asset:<id>" or "art:<key>" for a picture value, null when there is none.
create function youth.game_image_key(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'object' and jsonb_typeof(p -> 'asset') = 'string' then 'asset:' || (p ->> 'asset')
              when jsonb_typeof(p) = 'object' and jsonb_typeof(p -> 'art') = 'string' then 'art:' || (p ->> 'art') end;
$$;

-- Every uploaded asset a version's configuration refers to: a game's
-- pictures and a freehand coloring picture's line art (20261123000100).
create function youth.config_asset_ids(p jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.x::uuid), '{}')
    from (select s #>> '{image,asset}' x
            from jsonb_array_elements(case when jsonb_typeof(p -> 'scenes') = 'array' then p -> 'scenes' else '[]'::jsonb end) s
          union all
          select q #>> '{a,image,asset}'
            from jsonb_array_elements(case when jsonb_typeof(p -> 'pairs') = 'array' then p -> 'pairs' else '[]'::jsonb end) q
          union all
          select q #>> '{b,image,asset}'
            from jsonb_array_elements(case when jsonb_typeof(p -> 'pairs') = 'array' then p -> 'pairs' else '[]'::jsonb end) q
          union all
          select p #>> '{coloring,line_art_asset_id}') t
   where t.x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- Artwork that is part of a published (or earlier published) version: kept.
create function youth.asset_locked(p_asset uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from youth.activity_versions v
                  where v.state in ('published', 'retired')
                    and (v.cover_asset_id = p_asset or p_asset = any (youth.config_asset_ids(v.config))));
$$;

create function youth.game_text_problem(p jsonb, p_max integer, p_label text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null or jsonb_typeof(p) = 'null' then null
              when jsonb_typeof(p) <> 'string' then p_label || ' must be text.'
              when char_length(p #>> '{}') > p_max then p_label || ' must be ' || p_max || ' characters or fewer.' end;
$$;

-- A picture is optional while drafting; when present it must be one of
-- this activity's active uploads or a built-in illustration.
create function youth.game_image_problem(p_activity uuid, p jsonb, p_label text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p) <> 'object' or (p ? 'asset') = (p ? 'art') then
    return p_label || ' has a picture that isn''t valid. Choose it again.';
  end if;
  if p ? 'art' then
    if not coalesce(p ->> 'art', '') = any (youth.game_art_keys()) then
      return p_label || ' uses a built-in picture that doesn''t exist. Choose it again.';
    end if;
    return null;
  end if;
  if coalesce(p ->> 'asset', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not exists (select 1 from youth.activity_assets x
                     where x.id = (p ->> 'asset')::uuid and x.activity_id = p_activity and x.status = 'active') then
    return p_label || ': choose artwork uploaded for this activity.';
  end if;
  return null;
end;
$$;

create function youth.game_id_problem(p jsonb, p_seen text[], p_label text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) is distinct from 'string' or (p #>> '{}') !~ '^[a-z0-9][a-z0-9_-]{0,23}$'
                then p_label || ' is missing its identifier.'
              when (p #>> '{}') = any (p_seen)
                then p_label || ' has the same identifier as another one (' || (p #>> '{}') || '). Remove it and add it again.' end;
$$;

-- One card of a match pair.
create function youth.game_card_problem(p_activity uuid, p jsonb, p_label text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return p_label || ' isn''t valid.';
  end if;
  return coalesce(youth.game_image_problem(p_activity, p -> 'image', p_label),
                  youth.game_text_problem(p -> 'label', 40, p_label || '''s name'),
                  youth.game_text_problem(p -> 'description', 300, p_label || '''s description'));
end;
$$;

-- Problems with a game configuration's shape (null when acceptable or when
-- the version has no game). Raised when saving a draft.
create function youth.game_config_problem(p_activity uuid, p_kind text, c jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player text := c ->> 'player';
  v_items jsonb;
  e jsonb;
  s jsonb;
  i integer := 0;
  v_ids text[] := '{}';
  v_sizes integer[] := '{}';
  r text;
  v_label text;
begin
  if not (c ? 'player') then
    return null;
  end if;
  if v_player = 'story_order' then
    if p_kind <> 'puzzle' then
      return 'Put the Story in Order is a Puzzle activity. Choose the Puzzle type.';
    end if;
    v_items := c -> 'scenes';
    if jsonb_typeof(v_items) is distinct from 'array' then
      return 'The story''s scenes are missing.';
    end if;
    if jsonb_array_length(v_items) > 8 then
      return 'A story can have up to 8 scenes.';
    end if;
    for e in select * from jsonb_array_elements(v_items) loop
      i := i + 1;
      v_label := 'Scene ' || i;
      if jsonb_typeof(e) <> 'object' then
        return v_label || ' isn''t valid.';
      end if;
      r := coalesce(youth.game_id_problem(e -> 'id', v_ids, v_label),
                    youth.game_image_problem(p_activity, e -> 'image', v_label),
                    youth.game_text_problem(e -> 'caption', 80, v_label || '''s caption'),
                    youth.game_text_problem(e -> 'description', 300, v_label || '''s picture description'),
                    youth.game_text_problem(e -> 'clue', 160, v_label || '''s hint'),
                    youth.game_text_problem(e -> 'note', 300, v_label || '''s explanation'));
      if r is not null then return r; end if;
      v_ids := v_ids || (e ->> 'id');
    end loop;
    return youth.game_text_problem(c -> 'wrap_up', 600, 'The closing explanation');

  elsif v_player = 'bible_match' then
    if p_kind <> 'matching' then
      return 'Bible Match is a Matching activity. Choose the Matching type.';
    end if;
    if coalesce(c ->> 'mode', '') not in ('identical', 'related') then
      return 'Choose identical picture pairs or related pairs.';
    end if;
    if c ? 'show_moves' and jsonb_typeof(c -> 'show_moves') <> 'boolean' then
      return 'The move counter setting isn''t valid.';
    end if;
    if jsonb_typeof(c -> 'sizes') is distinct from 'array' then
      return 'Choose the board sizes.';
    end if;
    for s in select * from jsonb_array_elements(c -> 'sizes') loop
      if jsonb_typeof(s) <> 'number' or (s #>> '{}') not in ('3', '4', '6', '8', '10', '12') then
        return 'Board sizes can be 3, 4, 6, 8, 10, or 12 pairs.';
      end if;
      if (s #>> '{}')::integer = any (v_sizes) then
        return 'Each board size can be chosen once.';
      end if;
      v_sizes := v_sizes || (s #>> '{}')::integer;
    end loop;
    v_items := c -> 'pairs';
    if jsonb_typeof(v_items) is distinct from 'array' then
      return 'The pairs are missing.';
    end if;
    if jsonb_array_length(v_items) > 12 then
      return 'A board can have up to 12 pairs.';
    end if;
    for e in select * from jsonb_array_elements(v_items) loop
      i := i + 1;
      v_label := 'Pair ' || i;
      if jsonb_typeof(e) <> 'object' then
        return v_label || ' isn''t valid.';
      end if;
      r := coalesce(youth.game_id_problem(e -> 'id', v_ids, v_label),
                    youth.game_card_problem(p_activity, e -> 'a', v_label || ' (first card)'),
                    youth.game_card_problem(p_activity, e -> 'b', v_label || ' (second card)'),
                    youth.game_text_problem(e -> 'note', 300, v_label || '''s explanation'));
      if r is not null then return r; end if;
      v_ids := v_ids || (e ->> 'id');
    end loop;
    return null;
  end if;
  return 'Choose a supported game.';
end;
$$;

-- What still keeps a game version from being published (empty when ready,
-- or when the version has no game). Shown in the editor; checked on publish.
create function youth.game_config_issues(v youth.activity_versions)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c jsonb := v.config;
  v_out text[] := '{}';
  v_n integer;
  v_lo integer;
  v_hi integer;
  e jsonb;
  i integer := 0;
  v_seen jsonb := '{}'::jsonb;
  v_key text;
  v_side text;
  v_mode text;
  v_size integer;
begin
  if not (c ? 'player') then
    return v_out;
  end if;
  if c ->> 'player' = 'story_order' then
    v_n := case when jsonb_typeof(c -> 'scenes') = 'array' then jsonb_array_length(c -> 'scenes') else 0 end;
    v_lo := case v.difficulty when 'beginner' then 3 when 'growing' then 4 else 5 end;
    v_hi := case v.difficulty when 'beginner' then 4 when 'growing' then 6 else 8 end;
    if v_n = 0 then
      v_out := v_out || 'Add the story''s scenes, in the correct order.'::text;
    elsif v_n < v_lo or v_n > v_hi then
      v_out := v_out || format('A %s story needs %s to %s scenes (it has %s). Change the scenes or the difficulty.',
                               initcap(v.difficulty), v_lo, v_hi, v_n);
    end if;
    if v_n > 0 then
      for e in select * from jsonb_array_elements(c -> 'scenes') loop
        i := i + 1;
        if youth.game_image_key(e -> 'image') is null then
          v_out := v_out || format('Scene %s needs a picture.', i);
        elsif e #>> '{image,asset}' is not null and not exists (
                select 1 from youth.activity_assets x where x.id::text = e #>> '{image,asset}' and x.status = 'active') then
          v_out := v_out || format('Scene %s''s picture was removed. Choose another.', i);
        end if;
        if btrim(coalesce(e ->> 'caption', '')) = '' then
          v_out := v_out || format('Scene %s needs a caption.', i);
        end if;
      end loop;
    end if;

  elsif c ->> 'player' = 'bible_match' then
    v_mode := c ->> 'mode';
    v_n := case when jsonb_typeof(c -> 'pairs') = 'array' then jsonb_array_length(c -> 'pairs') else 0 end;
    if v_n < 3 then
      v_out := v_out || format('Add at least 3 pairs (there %s %s).', case when v_n = 1 then 'is' else 'are' end, v_n);
    end if;
    if v_n > 0 then
      for e in select * from jsonb_array_elements(c -> 'pairs') loop
        i := i + 1;
        foreach v_side in array case when v_mode = 'related' then array['a', 'b'] else array['a'] end loop
          v_key := youth.game_image_key(e -> v_side -> 'image');
          if v_key is not null and e -> v_side #>> '{image,asset}' is not null and not exists (
               select 1 from youth.activity_assets x where x.id::text = e -> v_side #>> '{image,asset}' and x.status = 'active') then
            v_out := v_out || format('Pair %s uses a picture that was removed. Choose another.', i);
          end if;
          if v_mode = 'identical' and v_key is null then
            v_out := v_out || format('Pair %s needs a picture.', i);
          elsif v_mode = 'related' and v_key is null and btrim(coalesce(e -> v_side ->> 'label', '')) = '' then
            v_out := v_out || format('Pair %s needs a picture or a name on its %s card.', i, case when v_side = 'a' then 'first' else 'second' end);
          end if;
          -- Two cards from different pairs that look the same can't be told apart.
          -- (Identical pairs are told apart by the picture; related cards by picture and name.)
          if v_mode = 'related' then
            v_key := case when v_key is null and btrim(coalesce(e -> v_side ->> 'label', '')) = '' then null
                          else coalesce(v_key, '') || '|' || lower(btrim(coalesce(e -> v_side ->> 'label', ''))) end;
          end if;
          if v_key is not null then
            if v_seen ? v_key and (v_seen ->> v_key)::integer <> i then
              v_out := v_out || format('Pairs %s and %s have cards that look the same. Change one of them.', v_seen ->> v_key, i);
            elsif not v_seen ? v_key then
              v_seen := v_seen || jsonb_build_object(v_key, i);
            end if;
          end if;
        end loop;
        if v_mode = 'related' and btrim(coalesce(e ->> 'note', '')) = '' then
          v_out := v_out || format('Pair %s needs a short explanation, shown when it''s matched.', i);
        end if;
      end loop;
    end if;
    if jsonb_typeof(c -> 'sizes') is distinct from 'array' or jsonb_array_length(c -> 'sizes') = 0 then
      v_out := v_out || 'Choose at least one board size.'::text;
    else
      for v_size in select (x #>> '{}')::integer from jsonb_array_elements(c -> 'sizes') x order by 1 loop
        if v_size > v_n then
          v_out := v_out || format('A board of %s pairs needs at least %s pairs (there %s %s).', v_size, v_size,
                                   case when v_n = 1 then 'is' else 'are' end, v_n);
        end if;
      end loop;
    end if;
  end if;
  -- Each problem once, in the order found.
  return array(select x from unnest(v_out) with ordinality t(x, n) group by x order by min(n));
end;
$$;

-- ---------------------------------------------------------------------------
-- Content: game configurations are checked when the draft is saved
-- (otherwise as in 20261123000100, which added the coloring picture rules)
-- ---------------------------------------------------------------------------
create or replace function youth.activity_content(p_activity uuid, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_refs text[];
  v_ref text;
  v_cover uuid := nullif(p ->> 'cover_asset_id', '')::uuid;
  v_config jsonb := coalesce(p -> 'config', '{}'::jsonb);
  v_problem text;
  v_out jsonb;
begin
  v_out := jsonb_build_object(
    'title', youth.clean_text(p ->> 'title', 120),
    'summary', youth.clean_text(p ->> 'summary', 300),
    'description', left(regexp_replace(coalesce(p ->> 'description', ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), 8000),
    'kind', p ->> 'kind', 'difficulty', p ->> 'difficulty',
    'age_min', nullif(p ->> 'age_min', '')::smallint, 'age_max', nullif(p ->> 'age_max', '')::smallint,
    'bible_story', youth.clean_text(p ->> 'bible_story', 160),
    'lesson_title', youth.clean_text(p ->> 'lesson_title', 160),
    'lesson_week', nullif(p ->> 'lesson_week', '')::date,
    'cover_asset_id', v_cover,
    'cover_alt', youth.clean_text(p ->> 'cover_alt', 300),
    'cover_decorative', coalesce((p ->> 'cover_decorative')::boolean, false),
    'content_source', coalesce(nullif(p ->> 'content_source', ''), 'original'),
    'content_credit', youth.clean_text(p ->> 'content_credit', 500),
    'change_note', youth.clean_text(p ->> 'change_note', 300),
    'config', v_config);
  if char_length(v_out ->> 'title') = 0 then
    raise exception 'Give the activity a title.' using errcode = '22023';
  end if;
  if coalesce(v_out ->> 'kind', '') not in ('story', 'quiz', 'matching', 'puzzle', 'drawing', 'word_game') then
    raise exception 'Choose an activity type.' using errcode = '22023';
  end if;
  if coalesce(v_out ->> 'difficulty', '') not in ('beginner', 'growing', 'challenge') then
    raise exception 'Choose a difficulty.' using errcode = '22023';
  end if;
  if (v_out ->> 'age_min')::int not between 2 and 18 or (v_out ->> 'age_max')::int not between 2 and 18
     or (v_out ->> 'age_max')::int < (v_out ->> 'age_min')::int then
    raise exception 'Suggested ages must be between 2 and 18, youngest first.' using errcode = '22023';
  end if;
  if v_out ->> 'content_source' not in ('original', 'adapted', 'licensed', 'public_domain', 'permission') then
    raise exception 'Choose where the content came from.' using errcode = '22023';
  end if;
  if v_out ->> 'content_source' <> 'original' and char_length(v_out ->> 'content_credit') = 0 then
    raise exception 'Say where the content came from and the permission or license for it.' using errcode = '22023';
  end if;
  if not youth.markup_free(v_out ->> 'title') or not youth.markup_free(v_out ->> 'summary') or not youth.markup_free(v_out ->> 'description')
     or not youth.markup_free(v_out ->> 'bible_story') or not youth.markup_free(v_out ->> 'lesson_title') or not youth.markup_free(v_out ->> 'cover_alt') then
    raise exception 'Activity text can''t contain HTML or scripts. Use Markdown formatting (like **bold**) instead.' using errcode = '22023';
  end if;
  -- Scripture references: short plain strings.
  select coalesce(array_agg(x), '{}') into v_refs
    from (select youth.clean_text(e, 60) x from jsonb_array_elements_text(coalesce(p -> 'scripture_refs', '[]'::jsonb)) e) s
   where x <> '';
  if cardinality(v_refs) > 10 then
    raise exception 'Add up to 10 Scripture references.' using errcode = '22023';
  end if;
  foreach v_ref in array v_refs loop
    if not youth.markup_free(v_ref) then
      raise exception 'Scripture references can''t contain HTML.' using errcode = '22023';
    end if;
  end loop;
  v_out := v_out || jsonb_build_object('scripture_refs', to_jsonb(v_refs));
  if v_cover is not null and not exists (select 1 from youth.activity_assets x where x.id = v_cover and x.activity_id = p_activity and x.status = 'active') then
    raise exception 'Choose artwork uploaded for this activity.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_config) <> 'object' or pg_column_size(v_config) > 262144 then
    raise exception 'The activity settings are too large.' using errcode = '22023';
  end if;
  -- The coloring picture has its own, stricter rules; every other key is data-only.
  v_problem := youth.activity_json_problem(v_config - 'coloring');
  if v_problem is not null then
    raise exception 'The activity settings %.', v_problem using errcode = '22023';
  end if;
  if v_config ? 'coloring' then
    if v_out ->> 'kind' <> 'drawing' then
      raise exception 'This activity has a coloring picture, so its type must stay Drawing & coloring. Remove the picture first to change the type.' using errcode = '22023';
    end if;
    v_problem := youth.coloring_template_problem(v_config -> 'coloring', p_activity);
    if v_problem is not null then
      raise exception 'The coloring picture %.', v_problem using errcode = '22023';
    end if;
  end if;
  v_problem := youth.game_config_problem(p_activity, v_out ->> 'kind', v_config);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member detail: the uploaded pictures a game uses (path and description)
-- ---------------------------------------------------------------------------
create or replace function youth.activity_detail(v youth.activity_versions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select youth.activity_card(v) || jsonb_build_object('description', v.description, 'config', v.config,
    'media', coalesce((select jsonb_object_agg(x.id, jsonb_build_object('path', x.path, 'alt', x.alt))
                         from youth.activity_assets x
                        where x.id = any (youth.config_asset_ids(v.config)) and x.activity_id = v.activity_id and x.status = 'active'), '{}'::jsonb));
$$;

-- Editors also see what still keeps a version from being published.
create or replace function youth.version_json(v youth.activity_versions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select youth.activity_detail(v) || jsonb_build_object(
    'state', v.state, 'cover_asset_id', v.cover_asset_id, 'cover_alt', v.cover_alt,
    'content_source', v.content_source, 'content_credit', v.content_credit, 'change_note', v.change_note,
    'created_at', v.created_at, 'updated_at', v.updated_at, 'updated_by', community.display_name(v.updated_by),
    'published_at', v.published_at, 'published_by', community.display_name(v.published_by), 'retired_at', v.retired_at,
    'issues', to_jsonb(youth.game_config_issues(v)));
$$;

-- ---------------------------------------------------------------------------
-- Administration: locked artwork includes game pictures and coloring line art
-- (config_asset_ids; otherwise as before)
-- ---------------------------------------------------------------------------
create or replace function public.youth_admin_activity(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  a youth.activities;
begin
  select * into a from youth.activities where id = p_id;
  if a.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', a.id, 'status', a.status, 'available_from', a.available_from, 'available_until', a.available_until,
    'live', youth.activity_live(a), 'first_published_at', a.first_published_at, 'archived_at', a.archived_at,
    'published', (select youth.version_json(v) from youth.activity_versions v where v.id = a.published_version_id),
    'draft', (select youth.version_json(v) from youth.activity_versions v where v.activity_id = a.id and v.state in ('draft', 'preview')),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'state', v.state, 'title', v.title,
                                                            'change_note', v.change_note, 'published_at', v.published_at,
                                                            'published_by', community.display_name(v.published_by)) order by v.version desc)
                           from youth.activity_versions v where v.activity_id = a.id), '[]'::jsonb),
    -- locked: part of a published (or earlier published) version, so it's kept.
    -- in_draft: a picture in the draft's scenes or pairs.
    'assets', coalesce((select jsonb_agg(youth.asset_json(x) || jsonb_build_object(
                                  'locked', youth.asset_locked(x.id),
                                  'in_draft', exists (select 1 from youth.activity_versions v
                                                       where v.activity_id = a.id and v.state in ('draft', 'preview')
                                                         and x.id = any (youth.config_asset_ids(v.config))))
                                order by x.created_at desc)
                         from youth.activity_assets x where x.activity_id = a.id and x.status = 'active'), '[]'::jsonb),
    'group_ids', coalesce((select jsonb_agg(g.group_id) from youth.activity_groups g where g.activity_id = a.id), '[]'::jsonb),
    -- Group names only: no rosters.
    'group_options', public.youth_admin_activity_groups(),
    -- Aggregate counts only (never who): how many children have progress on
    -- the published version, so editors know a new version starts fresh.
    'progress_on_published', (select count(*) from youth.activity_progress p where p.version_id = a.published_version_id));
end;
$$;

create or replace function public.youth_admin_activity_asset_remove(p_asset uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  x youth.activity_assets;
begin
  select * into x from youth.activity_assets where id = p_asset and status = 'active' for update;
  if x.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if youth.asset_locked(x.id) then
    raise exception 'This artwork is part of a published version, so it''s kept.' using errcode = '22023';
  end if;
  if exists (select 1 from youth.activity_versions v
              where v.activity_id = x.activity_id and v.state in ('draft', 'preview')
                and (v.config -> 'coloring' ->> 'line_art_asset_id') = x.id::text) then
    raise exception 'The draft''s coloring picture uses this artwork. Remove the coloring picture first.' using errcode = '22023';
  end if;
  if exists (select 1 from youth.activity_versions v
              where v.activity_id = x.activity_id and v.state in ('draft', 'preview') and x.id = any (youth.config_asset_ids(v.config))) then
    raise exception 'This artwork is used in the draft''s scenes or pairs. Choose another picture there first.' using errcode = '22023';
  end if;
  update youth.activity_versions set cover_asset_id = null, updated_by = v_uid where cover_asset_id = x.id and state in ('draft', 'preview');
  update youth.activity_assets set status = 'removed' where id = x.id;
  return jsonb_build_object('path', x.path);
end;
$$;

-- Publishing also needs a complete game (otherwise as in 20261118000200).
create or replace function public.youth_admin_activity_status(p_id uuid, p_action text, p_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  a youth.activities;
  d youth.activity_versions;
  x youth.activity_assets;
  v_issues text[];
begin
  select * into a from youth.activities where id = p_id for update;
  if a.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into d from youth.activity_versions where activity_id = a.id and state in ('draft', 'preview') for update;

  if p_action in ('ready', 'unready') then
    if d.id is null or a.status = 'archived' then
      raise exception 'There is no draft to change.' using errcode = '22023';
    end if;
    update youth.activity_versions set state = case when p_action = 'ready' then 'preview' else 'draft' end, updated_by = v_uid where id = d.id;
    if a.status in ('draft', 'preview') then
      update youth.activities set status = case when p_action = 'ready' then 'preview' else 'draft' end, updated_by = v_uid where id = a.id;
    end if;

  elsif p_action = 'publish' then
    if coalesce(p_confirm, '') <> 'publish' then
      raise exception 'Type "publish" to confirm.' using errcode = '22023';
    end if;
    if d.id is null or a.status = 'archived' then
      raise exception 'There is no draft to publish.' using errcode = '22023';
    end if;
    if d.cover_asset_id is not null then
      select * into x from youth.activity_assets where id = d.cover_asset_id;
      if x.status <> 'active' then
        raise exception 'The cover artwork was removed. Choose another before publishing.' using errcode = '22023';
      end if;
      if not d.cover_decorative and char_length(btrim(coalesce(nullif(d.cover_alt, ''), x.alt))) = 0 then
        raise exception 'Describe the cover artwork for people who can''t see it, or mark it decorative.' using errcode = '22023';
      end if;
    end if;
    v_issues := youth.game_config_issues(d);
    if cardinality(v_issues) > 0 then
      raise exception 'Not ready to publish yet: %', v_issues[1] using errcode = '22023';
    end if;
    update youth.activity_versions set state = 'retired', retired_at = now() where activity_id = a.id and state = 'published';
    update youth.activity_versions
       set state = 'published', published_by = v_uid, published_at = now(),
           cover_alt = case when cover_decorative then '' else coalesce(nullif(btrim(cover_alt), ''),
                         (select y.alt from youth.activity_assets y where y.id = cover_asset_id), '') end
     where id = d.id;
    update youth.activities
       set status = 'published', published_version_id = d.id, updated_by = v_uid, first_published_at = coalesce(first_published_at, now())
     where id = a.id;
    perform youth.audit('youth.activity_published', 'youth_activity', a.id, jsonb_build_object('version', d.version));

  elsif p_action = 'archive' then
    if coalesce(p_confirm, '') <> 'archive' then
      raise exception 'Type "archive" to confirm.' using errcode = '22023';
    end if;
    if a.status = 'archived' then
      return jsonb_build_object('status', a.status);
    end if;
    update youth.activities set status = 'archived', archived_at = now(), updated_by = v_uid where id = a.id;
    perform youth.audit('youth.activity_archived', 'youth_activity', a.id, '{}'::jsonb);

  elsif p_action = 'restore' then
    if a.status <> 'archived' then
      raise exception 'This activity isn''t archived.' using errcode = '22023';
    end if;
    -- Back to where it was: published if a version was published, else draft.
    -- Members see it again only if it was published.
    update youth.activities
       set status = case when published_version_id is not null then 'published'
                         when d.state = 'preview' then 'preview' else 'draft' end,
           archived_at = null, updated_by = v_uid
     where id = a.id;
    perform youth.audit('youth.activity_restored', 'youth_activity', a.id, '{}'::jsonb);

  elsif p_action = 'discard_draft' then
    if d.id is null or a.published_version_id is null then
      raise exception 'Only an unpublished change to a published activity can be discarded.' using errcode = '22023';
    end if;
    delete from youth.activity_versions where id = d.id;

  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  select * into a from youth.activities where id = p_id;
  return jsonb_build_object('status', a.status, 'published_version_id', a.published_version_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Progress: a completion survives replay (otherwise as in 20261118000200)
-- p: {data: object, completed: boolean, revision: integer (0 for a first save),
--     reset: boolean (true only to mark a completed version not finished)}
-- ---------------------------------------------------------------------------
create or replace function public.youth_activity_progress_save(p_activity uuid, p_child uuid, p_version uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_youth uuid := youth.account_child(v_uid);
  v_child uuid := coalesce(p_child, v_youth);
  a youth.activities;
  r youth.activity_progress;
  v_data jsonb := coalesce(p -> 'data', '{}'::jsonb);
  v_done boolean := coalesce((p ->> 'completed')::boolean, false);
  v_reset boolean := coalesce((p ->> 'reset')::boolean, false);
  v_rev integer := coalesce((p ->> 'revision')::integer, 0);
  v_problem text;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  -- An independent youth saves only for themselves; anyone else must name the child.
  if v_child is null or (v_youth is not null and v_child <> v_youth)
     or not youth.activity_plays_for(v_child, v_uid) or not youth.activity_open_to_child(p_activity, v_child) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  perform community.rate_limit(v_uid, 'youth_activity_save', 300, interval '10 minutes');
  select * into a from youth.activities where id = p_activity for share;
  -- A page loaded before a new version was published: nothing is written,
  -- and the earlier progress stays on the version it was made on.
  if a.published_version_id is distinct from p_version then
    return jsonb_build_object('conflict', 'version');
  end if;
  if jsonb_typeof(v_data) <> 'object' or pg_column_size(v_data) > 32768 then
    raise exception 'That progress is too large to save.' using errcode = '22023';
  end if;
  v_problem := youth.activity_json_problem(v_data);
  if v_problem is not null then
    raise exception 'That progress couldn''t be saved: it %.', v_problem using errcode = '22023';
  end if;

  select * into r from youth.activity_progress where child_id = v_child and version_id = p_version for update;
  if r.id is null then
    if v_rev <> 0 then
      return jsonb_build_object('conflict', 'revision');
    end if;
    insert into youth.activity_progress (child_id, activity_id, version_id, status, data, last_operator_id, completed_at)
    values (v_child, p_activity, p_version, case when v_done then 'completed' else 'started' end, v_data, v_uid,
            case when v_done then now() end)
    on conflict (child_id, version_id) do nothing
    returning * into r;
    if r.id is null then
      return jsonb_build_object('conflict', 'revision');
    end if;
  else
    -- Saved meanwhile from another tab or device: don't overwrite it.
    if r.revision <> v_rev then
      return jsonb_build_object('conflict', 'revision');
    end if;
    -- Replaying a finished activity keeps it finished.
    v_done := v_done or (r.status = 'completed' and not v_reset);
    update youth.activity_progress
       set data = v_data, status = case when v_done then 'completed' else 'started' end,
           completed_at = case when v_done then coalesce(r.completed_at, now()) end,
           revision = r.revision + 1, last_operator_id = v_uid, updated_at = now()
     where id = r.id
    returning * into r;
  end if;
  return youth.progress_json(r, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: members read the pictures of the published version's game too
-- (and its coloring line art, through config_asset_ids, as in 20261123000100)
-- ---------------------------------------------------------------------------
create or replace function youth.activity_object_readable(p_name text, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from youth.activity_assets x
     where x.path = p_name
       and ((public.has_capability('youth.activities') and x.status in ('pending', 'active'))
            or (x.status = 'active' and exists (
                  select 1 from youth.activities a join youth.activity_versions v on v.id = a.published_version_id
                   where a.id = x.activity_id
                     and (v.cover_asset_id = x.id or x.id = any (youth.config_asset_ids(v.config)))
                     and youth.activity_open_for(a.id, p_profile)))));
$$;

-- ---------------------------------------------------------------------------
-- Grants: the new helpers are internal (public functions keep their grants)
-- ---------------------------------------------------------------------------
revoke execute on function
  youth.game_art_keys(), youth.game_image_key(jsonb), youth.config_asset_ids(jsonb), youth.asset_locked(uuid),
  youth.game_text_problem(jsonb, integer, text), youth.game_image_problem(uuid, jsonb, text), youth.game_id_problem(jsonb, text[], text),
  youth.game_card_problem(uuid, jsonb, text), youth.game_config_problem(uuid, text, jsonb), youth.game_config_issues(youth.activity_versions)
  from public, anon, authenticated, service_role;

-- Expected afterwards: the helpers exist and no API role can run them; the
-- member and editor functions are still granted to authenticated only.
do $check$
begin
  if to_regprocedure('youth.game_config_problem(uuid, text, jsonb)') is null
     or to_regprocedure('youth.game_config_issues(youth.activity_versions)') is null
     or to_regprocedure('youth.config_asset_ids(jsonb)') is null then
    raise exception 'Nothing was changed: the game helpers are missing. Send this message to the developer.';
  end if;
  if has_function_privilege('authenticated', 'youth.game_config_problem(uuid, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'youth.game_config_issues(youth.activity_versions)', 'execute')
     or has_function_privilege('service_role', 'youth.asset_locked(uuid)', 'execute')
     or has_function_privilege('anon', 'public.youth_activity_progress_save(uuid, uuid, uuid, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.youth_activity_progress_save(uuid, uuid, uuid, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.youth_admin_activity_status(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.youth_admin_activity(uuid)', 'execute') then
    raise exception 'Nothing was changed: function grants are not as expected. Send this message to the developer.';
  end if;
  -- The coloring rules from 20261123000100 are still enforced alongside the game checks.
  if pg_get_functiondef('youth.activity_content(uuid, jsonb)'::regprocedure) not like '%coloring_template_problem%'
     or pg_get_functiondef('youth.activity_content(uuid, jsonb)'::regprocedure) not like '%game_config_problem%'
     or youth.config_asset_ids('{"coloring": {"line_art_asset_id": "00000000-0000-4000-8000-000000000001"}}'::jsonb)
        <> array['00000000-0000-4000-8000-000000000001'::uuid] then
    raise exception 'Nothing was changed: the coloring rules would be lost. Send this message to the developer.';
  end if;
  -- Every activity saved so far has no game, so nothing published changes meaning.
  if exists (select 1 from youth.activity_versions v where v.config ? 'player') then
    raise notice 'Note: % version(s) already carry config.player.', (select count(*) from youth.activity_versions v where v.config ? 'player');
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261124000100', 'youth_activity_games', 'youth-activity-games');

commit;
