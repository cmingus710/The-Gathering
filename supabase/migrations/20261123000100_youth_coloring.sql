-- Youth & Families · Learn & Play: Bible Coloring Studio (additive).
--
-- Builds on the activity foundation (20261118000200). A "Drawing & coloring"
-- activity version can carry a coloring picture in its data-only config, and
-- each child's artwork is saved privately against that exact version.
--
-- The picture (config.coloring), validated by youth.coloring_template_problem
--   * Never uploaded markup. The editor's SVG is parsed and checked in the app
--     (scripts, event handlers, links, external resources, styles, images,
--     text, animation and anything unknown are refused) and only rebuilt,
--     normalized path data (absolute M/L/C/Z commands and numbers) is kept.
--   * mode 'regions': fillable parts {id, label, d, rule, w} plus line-art
--     details {d, w, fill}. Tap-to-fill and "stay inside the lines" use these.
--   * mode 'freehand': ordinary line art uploaded through the existing artwork
--     pipeline (re-encoded WebP), referenced by line_art_asset_id. No parts:
--     it can't be tap-filled, and the editor labels it freehand-only.
--   * A short story summary (the text alternative to the picture) and the
--     artwork's attribution (source kind, credit, license, https link).
--   * Only on 'drawing' activities. Published versions stay immutable, so a
--     changed picture is a new version, exactly like any other content.
--
-- A child's artwork (youth.coloring_artwork)
--   * One row per child profile and activity version; never on an adult.
--   * Only the child's own youth account, or a guardian who may currently
--     play for that child (youth.activity_plays_for), can read or save it,
--     checked on every call. Guardians with progress summaries only, leaders,
--     editors and other staff get nothing. Nothing is shared or published
--     (the Media gallery is untouched).
--   * Each save names the version and the revision it was based on; a save
--     from an older page, another tab, or another device gets a conflict with
--     the saved artwork, and nothing is written.
--   * The data is checked against the picture: filled parts must exist, colors
--     come from the fixed palette, strokes are bounded integer point lists.
--
-- Replaced with the same signatures (each copied from 20261118000200, with
-- only the change described):
--   * youth.activity_content: validates config.coloring with its own rules
--     (the generic data-only check still covers every other config key), and
--     allows a coloring picture only on 'drawing' activities.
--   * public.youth_admin_activity_save: a save that sends no config keeps the
--     draft's (or, for a new draft, the published version's) config, so the
--     ordinary editor form never drops a coloring picture.
--   * youth.activity_object_readable: members may also read the line art of a
--     freehand picture in the published version of an activity open to them.
--   * public.youth_admin_activity_asset_remove: line art used by any version
--     is kept, like a cover.
--   * public.youth_admin_activity: 'locked' also covers published line art.
-- The activity config limit rises from 64 KB to 256 KB (stored size) so a
-- detailed picture fits; the content checks are unchanged otherwise.

-- ---------------------------------------------------------------------------
-- Config size
-- ---------------------------------------------------------------------------
alter table youth.activity_versions drop constraint activity_versions_config_check;
alter table youth.activity_versions add constraint activity_versions_config_check
  check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 262144);

-- ---------------------------------------------------------------------------
-- The picture
-- ---------------------------------------------------------------------------
-- The fixed palette (keys only; the app holds the colors and names).
create function youth.coloring_palette()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['red', 'orange', 'yellow', 'green', 'sky', 'blue', 'purple', 'pink', 'brown', 'peach', 'white', 'black'];
$$;

create function youth.coloring_num(p jsonb, p_min numeric, p_max numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric between p_min and p_max else false end;
$$;

create function youth.coloring_int(p jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^[0-9]{1,5}$' then (p #>> '{}')::integer between p_min and p_max else false end;
$$;

-- Problems with a coloring picture, or null when acceptable.
create function youth.coloring_template_problem(t jsonb, p_activity uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text;
  r jsonb;
  a jsonb;
  v_ids text[] := '{}';
  v_mode text;
begin
  if jsonb_typeof(t) <> 'object' then
    return 'isn''t a coloring picture';
  end if;
  for k in select jsonb_object_keys(t) loop
    if k not in ('format', 'mode', 'width', 'height', 'outline', 'regions', 'lines', 'line_art_asset_id', 'story', 'attribution') then
      return 'has an unsupported field';
    end if;
  end loop;
  v_mode := t ->> 'mode';
  if coalesce(t ->> 'format', '') <> '1' or coalesce(v_mode, '') not in ('regions', 'freehand') then
    return 'isn''t a supported coloring picture format';
  end if;
  if not youth.coloring_int(t -> 'width', 100, 1000) or not youth.coloring_int(t -> 'height', 100, 1000) then
    return 'has an unsupported size';
  end if;
  if t ? 'outline' and not youth.coloring_num(t -> 'outline', 0, 24) then
    return 'has an unsupported outline width';
  end if;
  if jsonb_typeof(coalesce(t -> 'regions', 'null')) <> 'array' or jsonb_typeof(coalesce(t -> 'lines', 'null')) <> 'array' then
    return 'is missing its parts';
  end if;
  if jsonb_array_length(t -> 'regions') > 300 or jsonb_array_length(t -> 'lines') > 800 then
    return 'has too many parts';
  end if;

  if v_mode = 'regions' then
    if jsonb_array_length(t -> 'regions') = 0 then
      return 'has no parts to fill';
    end if;
    if t ? 'line_art_asset_id' then
      return 'mixes tap-to-fill parts with uploaded line art';
    end if;
    for r in select * from jsonb_array_elements(t -> 'regions') loop
      if jsonb_typeof(r) <> 'object' or exists (select 1 from jsonb_object_keys(r) x where x not in ('id', 'label', 'd', 'rule', 'w'))
         or not (r ? 'id' and r ? 'label' and r ? 'd' and r ? 'rule' and r ? 'w') then
        return 'has a part in an unsupported format';
      end if;
      if coalesce(r ->> 'id', '') !~ '^r[0-9]{1,3}$' or (r ->> 'id') = any (v_ids) then
        return 'has a part without a unique id';
      end if;
      v_ids := v_ids || (r ->> 'id');
      if jsonb_typeof(r -> 'label') <> 'string' or char_length(btrim(r ->> 'label')) not between 1 and 80
         or (r ->> 'label') ~ '[\x01-\x1F\x7F]' or not youth.markup_free(r ->> 'label') then
        return 'has a part without a plain-text name';
      end if;
      if jsonb_typeof(r -> 'd') <> 'string' or char_length(r ->> 'd') not between 2 and 40000 or (r ->> 'd') !~ '^M[MLCZ0-9 .-]*$' then
        return 'has a part with unsupported shape data';
      end if;
      if coalesce(r ->> 'rule', '') not in ('nonzero', 'evenodd') or not youth.coloring_num(r -> 'w', 0, 40) then
        return 'has a part with unsupported drawing settings';
      end if;
    end loop;
  else
    if jsonb_array_length(t -> 'regions') > 0 or jsonb_array_length(t -> 'lines') > 0 then
      return 'is freehand-only, so it can''t have tap-to-fill parts';
    end if;
    if not exists (select 1 from youth.activity_assets x
                    where x.id::text = (t ->> 'line_art_asset_id') and x.activity_id = p_activity and x.status = 'active') then
      return 'needs line art uploaded for this activity';
    end if;
  end if;

  for r in select * from jsonb_array_elements(t -> 'lines') loop
    if jsonb_typeof(r) <> 'object' or exists (select 1 from jsonb_object_keys(r) x where x not in ('d', 'w', 'fill'))
       or not (r ? 'd' and r ? 'w') or jsonb_typeof(r -> 'd') <> 'string' or char_length(r ->> 'd') not between 2 and 40000 or (r ->> 'd') !~ '^M[MLCZ0-9 .-]*$'
       or not youth.coloring_num(r -> 'w', 0, 40) or jsonb_typeof(coalesce(r -> 'fill', 'false')) <> 'boolean' then
      return 'has line art in an unsupported format';
    end if;
  end loop;

  if jsonb_typeof(coalesce(t -> 'story', '""')) <> 'string' or char_length(coalesce(t ->> 'story', '')) > 1500
     or coalesce(t ->> 'story', '') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' or not youth.markup_free(t ->> 'story') then
    return 'has a story summary that isn''t plain text (1,500 characters at most)';
  end if;

  a := t -> 'attribution';
  if coalesce(jsonb_typeof(a), '') <> 'object' or exists (select 1 from jsonb_object_keys(a) x where x not in ('source_kind', 'credit', 'license', 'source_url')) then
    return 'needs the artwork''s attribution';
  end if;
  if coalesce(a ->> 'source_kind', '') not in ('original', 'licensed', 'public_domain', 'permission') then
    return 'needs to say where the artwork came from';
  end if;
  if jsonb_typeof(coalesce(a -> 'credit', '""')) <> 'string' or jsonb_typeof(coalesce(a -> 'license', '""')) <> 'string'
     or char_length(coalesce(a ->> 'credit', '')) > 300 or char_length(coalesce(a ->> 'license', '')) > 300
     or not youth.markup_free(a ->> 'credit') or not youth.markup_free(a ->> 'license')
     or coalesce(a ->> 'credit', '') || coalesce(a ->> 'license', '') ~ '[\x01-\x1F\x7F]' then
    return 'has attribution that isn''t plain text';
  end if;
  if a ->> 'source_kind' <> 'original' and char_length(btrim(coalesce(a ->> 'credit', ''))) = 0 then
    return 'needs the artist or source for artwork that isn''t original';
  end if;
  if a ? 'source_url' and jsonb_typeof(a -> 'source_url') <> 'null'
     and (jsonb_typeof(a -> 'source_url') <> 'string' or (a ->> 'source_url') !~ '^https://[^\s<>"]+$' or char_length(a ->> 'source_url') > 500) then
    return 'has a source link that doesn''t start with https://';
  end if;
  return null;
end;
$$;

-- Problems with a child's artwork for this picture, or null when acceptable.
-- doc: {fills: {<part id>: <palette key>}, strokes: [{t: 'paint'|'erase',
-- c: <palette key> (paint only), s: 's'|'m'|'l', p: 'x,y x,y …', r: <part id>}]}
create function youth.coloring_doc_problem(doc jsonb, t jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  s jsonb;
  v_ids text[];
  v_palette text[] := youth.coloring_palette();
begin
  if jsonb_typeof(doc) <> 'object' or exists (select 1 from jsonb_object_keys(doc) x where x not in ('fills', 'strokes')) then
    return 'isn''t a coloring picture';
  end if;
  select coalesce(array_agg(r ->> 'id'), '{}') into v_ids from jsonb_array_elements(coalesce(t -> 'regions', '[]'::jsonb)) r;
  if jsonb_typeof(coalesce(doc -> 'fills', '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(doc -> 'strokes', '[]'::jsonb)) <> 'array' then
    return 'isn''t a coloring picture';
  end if;
  for k, v in select * from jsonb_each(coalesce(doc -> 'fills', '{}'::jsonb)) loop
    if not (k = any (v_ids)) then
      return 'colors a part the picture doesn''t have';
    end if;
    if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (v_palette)) then
      return 'uses a color that isn''t in the palette';
    end if;
  end loop;
  if jsonb_array_length(coalesce(doc -> 'strokes', '[]'::jsonb)) > 2000 then
    return 'has too many brush strokes';
  end if;
  for s in select * from jsonb_array_elements(coalesce(doc -> 'strokes', '[]'::jsonb)) loop
    if jsonb_typeof(s) <> 'object' or exists (select 1 from jsonb_object_keys(s) x where x not in ('t', 'c', 's', 'p', 'r'))
       or not (s ? 't' and s ? 's' and s ? 'p') then
      return 'has a brush stroke in an unsupported format';
    end if;
    if coalesce(s ->> 't', '') = 'paint' then
      if not (s ? 'c') or jsonb_typeof(s -> 'c') <> 'string' or not ((s ->> 'c') = any (v_palette)) then
        return 'uses a color that isn''t in the palette';
      end if;
    elsif coalesce(s ->> 't', '') = 'erase' then
      if s ? 'c' then
        return 'has a brush stroke in an unsupported format';
      end if;
    else
      return 'has a brush stroke in an unsupported format';
    end if;
    if coalesce(s ->> 's', '') not in ('s', 'm', 'l') then
      return 'has an unsupported brush size';
    end if;
    if jsonb_typeof(s -> 'p') <> 'string' or char_length(s ->> 'p') > 18000
       or (s ->> 'p') !~ '^-?[0-9]{1,4},-?[0-9]{1,4}( -?[0-9]{1,4},-?[0-9]{1,4})*$' then
      return 'has a brush stroke in an unsupported format';
    end if;
    if s ? 'r' and (jsonb_typeof(s -> 'r') <> 'string' or not ((s ->> 'r') = any (v_ids))) then
      return 'keeps a stroke inside a part the picture doesn''t have';
    end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- A child's artwork
-- ---------------------------------------------------------------------------
create table youth.coloring_artwork (
  id uuid primary key default gen_random_uuid(),
  -- Always a child profile: never an adult's profile.
  child_id uuid not null references youth.children (id) on delete cascade,
  activity_id uuid not null references youth.activities (id) on delete cascade,
  -- The exact version (and so the exact picture); never moved to a later one.
  version_id uuid not null references youth.activity_versions (id) on delete restrict,
  doc jsonb not null default '{}'::jsonb check (jsonb_typeof(doc) = 'object' and octet_length(doc::text) <= 400000),
  -- Bumped on every save; a save must name the revision it was based on.
  revision integer not null default 1 check (revision >= 1),
  -- Who was at the device: the youth account or the guardian coloring with the child.
  last_operator_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, version_id)
);
create index coloring_artwork_activity_idx on youth.coloring_artwork (activity_id);
create index coloring_artwork_version_idx on youth.coloring_artwork (version_id);
create index coloring_artwork_child_idx on youth.coloring_artwork (child_id, activity_id);
create index coloring_artwork_operator_idx on youth.coloring_artwork (last_operator_id);

alter table youth.coloring_artwork enable row level security;
revoke all on youth.coloring_artwork from public, anon, authenticated;

-- The child this person may color for on this activity, or "not found":
-- an independent youth only for themselves, anyone else only for a named
-- child they may play for, and only while the activity is open to them.
create function youth.coloring_child(p_activity uuid, p_child uuid, p_uid uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_youth uuid := youth.account_child(p_uid);
  v_child uuid := coalesce(p_child, v_youth);
begin
  if p_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  if v_child is null or (v_youth is not null and v_child <> v_youth)
     or not youth.activity_plays_for(v_child, p_uid) or not youth.activity_open_to_child(p_activity, v_child) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return v_child;
end;
$$;

-- The chosen child's artwork on the published version (revision 0 and an
-- empty picture when they haven't started), and whether they have artwork
-- kept on an earlier version.
create function public.youth_coloring_artwork(p_activity uuid, p_child uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_child uuid := youth.coloring_child(p_activity, p_child, v_uid);
  a youth.activities;
  w youth.coloring_artwork;
begin
  select * into a from youth.activities where id = p_activity;
  select * into w from youth.coloring_artwork where child_id = v_child and version_id = a.published_version_id;
  return jsonb_build_object(
    'child_id', v_child, 'version_id', a.published_version_id,
    'revision', coalesce(w.revision, 0), 'doc', coalesce(w.doc, '{}'::jsonb), 'updated_at', w.updated_at,
    'earlier', exists (select 1 from youth.coloring_artwork x
                        where x.child_id = v_child and x.activity_id = a.id and x.version_id <> a.published_version_id));
end;
$$;

-- Save the chosen child's artwork on the current version.
-- Returns {status: 'saved', revision, updated_at},
--         {status: 'conflict', current: {revision, doc, updated_at}} (saved
--         meanwhile elsewhere; nothing written), or
--         {status: 'version'} (a new version was published; nothing written).
create function public.youth_coloring_save(p_activity uuid, p_child uuid, p_version uuid, p_base_revision integer, p_doc jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_child uuid := youth.coloring_child(p_activity, p_child, v_uid);
  a youth.activities;
  v_template jsonb;
  v_problem text;
  w youth.coloring_artwork;
begin
  perform community.rate_limit(v_uid, 'youth_coloring_save', 600, interval '10 minutes');
  select * into a from youth.activities where id = p_activity for share;
  if a.published_version_id is distinct from p_version then
    return jsonb_build_object('status', 'version');
  end if;
  select v.config -> 'coloring' into v_template from youth.activity_versions v where v.id = a.published_version_id;
  if v_template is null then
    raise exception 'This activity doesn''t have a coloring picture.' using errcode = '22023';
  end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' or octet_length(p_doc::text) > 400000 then
    raise exception 'This picture is too large to save. Try starting over on a fresh page.' using errcode = '22023';
  end if;
  v_problem := youth.coloring_doc_problem(p_doc, v_template);
  if v_problem is not null then
    raise exception 'That picture couldn''t be saved: it %.', v_problem using errcode = '22023';
  end if;

  select * into w from youth.coloring_artwork where child_id = v_child and version_id = p_version for update;
  if w.id is null then
    if coalesce(p_base_revision, -1) <> 0 then
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('revision', 0, 'doc', '{}'::jsonb, 'updated_at', null));
    end if;
    insert into youth.coloring_artwork (child_id, activity_id, version_id, doc, last_operator_id)
    values (v_child, p_activity, p_version, p_doc, v_uid)
    on conflict (child_id, version_id) do nothing
    returning * into w;
    if w.id is null then
      select * into w from youth.coloring_artwork where child_id = v_child and version_id = p_version;
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('revision', w.revision, 'doc', w.doc, 'updated_at', w.updated_at));
    end if;
  else
    -- Saved meanwhile from another tab or device: don't overwrite it.
    if w.revision is distinct from p_base_revision then
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('revision', w.revision, 'doc', w.doc, 'updated_at', w.updated_at));
    end if;
    update youth.coloring_artwork
       set doc = p_doc, revision = w.revision + 1, last_operator_id = v_uid, updated_at = now()
     where id = w.id
    returning * into w;
  end if;
  return jsonb_build_object('status', 'saved', 'revision', w.revision, 'updated_at', w.updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration (youth.activities)
-- ---------------------------------------------------------------------------
-- Set (or, with null, remove) the draft's coloring picture. Editing a
-- published activity starts a new draft version copied from the published
-- one; the published version is untouched.
create function public.youth_admin_activity_coloring_set(p_id uuid, p_coloring jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  a youth.activities;
  d youth.activity_versions;
  v_problem text;
begin
  perform community.rate_limit(v_uid, 'youth_activity_admin', 300, interval '10 minutes');
  select * into a from youth.activities where id = p_id for update;
  if a.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if a.status = 'archived' then
    raise exception 'Restore this activity before editing it.' using errcode = '22023';
  end if;
  select * into d from youth.activity_versions where activity_id = a.id and state in ('draft', 'preview') for update;
  if d.id is null then
    insert into youth.activity_versions (activity_id, version, title, summary, description, kind, difficulty, age_min, age_max,
                                         bible_story, scripture_refs, lesson_title, lesson_week, cover_asset_id, cover_alt,
                                         cover_decorative, content_source, content_credit, config, change_note, created_by, updated_by)
    select v.activity_id, (select max(version) + 1 from youth.activity_versions where activity_id = a.id), v.title, v.summary, v.description,
           v.kind, v.difficulty, v.age_min, v.age_max, v.bible_story, v.scripture_refs, v.lesson_title, v.lesson_week,
           (select x.id from youth.activity_assets x where x.id = v.cover_asset_id and x.status = 'active'), v.cover_alt,
           v.cover_decorative, v.content_source, v.content_credit, v.config, '', v_uid, v_uid
      from youth.activity_versions v where v.id = a.published_version_id
    returning * into d;
  end if;
  if d.id is null then
    raise exception 'There is no draft to change.' using errcode = '22023';
  end if;
  if p_coloring is null or jsonb_typeof(p_coloring) = 'null' then
    update youth.activity_versions set state = 'draft', config = config - 'coloring', updated_by = v_uid where id = d.id returning * into d;
  else
    if d.kind <> 'drawing' then
      raise exception 'Coloring pictures are for Drawing & coloring activities. Change the type first.' using errcode = '22023';
    end if;
    v_problem := youth.coloring_template_problem(p_coloring, a.id);
    if v_problem is not null then
      raise exception 'That coloring picture %.', v_problem using errcode = '22023';
    end if;
    if pg_column_size(d.config || jsonb_build_object('coloring', p_coloring)) > 262144 then
      raise exception 'That coloring picture is too detailed to store. Simplify the artwork and try again.' using errcode = '22023';
    end if;
    update youth.activity_versions
       set state = 'draft', config = config || jsonb_build_object('coloring', p_coloring), updated_by = v_uid
     where id = d.id
    returning * into d;
  end if;
  update youth.activities
     set updated_by = v_uid, status = case when status = 'preview' then 'draft' else status end
   where id = a.id;
  perform youth.audit('youth.activity_coloring_set', 'youth_activity', a.id,
                      jsonb_build_object('version', d.version, 'mode', p_coloring ->> 'mode'));
  return jsonb_build_object('id', a.id, 'version_id', d.id, 'version', d.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced: youth.activity_content (coloring picture rules)
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
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced: public.youth_admin_activity_save (keeps config when none is sent)
-- ---------------------------------------------------------------------------
create or replace function public.youth_admin_activity_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := youth.require_cap('youth.activities');
  a youth.activities;
  d youth.activity_versions;
  c jsonb;
  v_from timestamptz := nullif(p ->> 'available_from', '')::timestamptz;
  v_until timestamptz := nullif(p ->> 'available_until', '')::timestamptz;
begin
  perform community.rate_limit(v_uid, 'youth_activity_admin', 300, interval '10 minutes');
  if v_until is not null and v_from is not null and v_until <= v_from then
    raise exception 'The end of the availability window must be after its start.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into youth.activities (created_by, updated_by, available_from, available_until)
    values (v_uid, v_uid, v_from, v_until) returning * into a;
    c := youth.activity_content(a.id, p);
    insert into youth.activity_versions (activity_id, version, title, summary, description, kind, difficulty, age_min, age_max,
                                         bible_story, scripture_refs, lesson_title, lesson_week, cover_asset_id, cover_alt,
                                         cover_decorative, content_source, content_credit, config, change_note, created_by, updated_by)
    select a.id, 1, c ->> 'title', c ->> 'summary', c ->> 'description', c ->> 'kind', c ->> 'difficulty',
           (c ->> 'age_min')::smallint, (c ->> 'age_max')::smallint, c ->> 'bible_story',
           array(select jsonb_array_elements_text(c -> 'scripture_refs')), c ->> 'lesson_title', (c ->> 'lesson_week')::date,
           null, c ->> 'cover_alt', (c ->> 'cover_decorative')::boolean, c ->> 'content_source', c ->> 'content_credit',
           c -> 'config', c ->> 'change_note', v_uid, v_uid
    returning * into d;
    perform youth.audit('youth.activity_created', 'youth_activity', a.id, '{}'::jsonb);
    return jsonb_build_object('id', a.id, 'version_id', d.id, 'version', d.version);
  end if;

  select * into a from youth.activities where id = p_id for update;
  if a.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if a.status = 'archived' then
    raise exception 'Restore this activity before editing it.' using errcode = '22023';
  end if;
  select * into d from youth.activity_versions where activity_id = a.id and state in ('draft', 'preview') for update;
  -- The editor form doesn't send config: keep what the draft (or the
  -- published version a new draft starts from) already has.
  if not (p ? 'config') then
    p := p || jsonb_build_object('config', coalesce(d.config,
           (select v.config from youth.activity_versions v where v.id = a.published_version_id), '{}'::jsonb));
  end if;
  c := youth.activity_content(a.id, p);
  if d.id is null then
    insert into youth.activity_versions (activity_id, version, title, kind, difficulty, created_by, updated_by)
    values (a.id, (select max(version) + 1 from youth.activity_versions where activity_id = a.id),
            c ->> 'title', c ->> 'kind', c ->> 'difficulty', v_uid, v_uid)
    returning * into d;
  end if;
  -- Any edit returns a version that was ready for preview to draft.
  update youth.activity_versions
     set state = 'draft', title = c ->> 'title', summary = c ->> 'summary', description = c ->> 'description',
         kind = c ->> 'kind', difficulty = c ->> 'difficulty', age_min = (c ->> 'age_min')::smallint, age_max = (c ->> 'age_max')::smallint,
         bible_story = c ->> 'bible_story', scripture_refs = array(select jsonb_array_elements_text(c -> 'scripture_refs')),
         lesson_title = c ->> 'lesson_title', lesson_week = (c ->> 'lesson_week')::date,
         cover_asset_id = (c ->> 'cover_asset_id')::uuid, cover_alt = c ->> 'cover_alt', cover_decorative = (c ->> 'cover_decorative')::boolean,
         content_source = c ->> 'content_source', content_credit = c ->> 'content_credit', config = c -> 'config',
         change_note = c ->> 'change_note', updated_by = v_uid
   where id = d.id
  returning * into d;
  update youth.activities
     set available_from = v_from, available_until = v_until, updated_by = v_uid,
         status = case when status = 'preview' then 'draft' else status end
   where id = a.id;
  return jsonb_build_object('id', a.id, 'version_id', d.id, 'version', d.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced: artwork reads, removal, and the editor's locked flag (line art)
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
                     and (v.cover_asset_id = x.id or (v.config -> 'coloring' ->> 'line_art_asset_id') = x.id::text)
                     and youth.activity_open_for(a.id, p_profile)))));
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
  if exists (select 1 from youth.activity_versions v
              where v.activity_id = x.activity_id and v.state in ('published', 'retired')
                and (v.cover_asset_id = x.id or (v.config -> 'coloring' ->> 'line_art_asset_id') = x.id::text)) then
    raise exception 'This artwork is part of a published version, so it''s kept.' using errcode = '22023';
  end if;
  if exists (select 1 from youth.activity_versions v
              where v.activity_id = x.activity_id and v.state in ('draft', 'preview')
                and (v.config -> 'coloring' ->> 'line_art_asset_id') = x.id::text) then
    raise exception 'The draft''s coloring picture uses this artwork. Remove the coloring picture first.' using errcode = '22023';
  end if;
  update youth.activity_versions set cover_asset_id = null, updated_by = v_uid where cover_asset_id = x.id and state in ('draft', 'preview');
  update youth.activity_assets set status = 'removed' where id = x.id;
  return jsonb_build_object('path', x.path);
end;
$$;

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
    'assets', coalesce((select jsonb_agg(youth.asset_json(x) || jsonb_build_object('locked', exists (
                                  select 1 from youth.activity_versions v
                                   where v.activity_id = a.id and v.state in ('published', 'retired')
                                     and (v.cover_asset_id = x.id or (v.config -> 'coloring' ->> 'line_art_asset_id') = x.id::text)))
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

-- ---------------------------------------------------------------------------
-- Grants: internal helpers closed; public entry points for signed-in people
-- ---------------------------------------------------------------------------
revoke execute on function
  youth.coloring_palette(), youth.coloring_num(jsonb, numeric, numeric), youth.coloring_int(jsonb, integer, integer), youth.coloring_template_problem(jsonb, uuid),
  youth.coloring_doc_problem(jsonb, jsonb), youth.coloring_child(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

revoke execute on function
  public.youth_coloring_artwork(uuid, uuid), public.youth_coloring_save(uuid, uuid, uuid, integer, jsonb),
  public.youth_admin_activity_coloring_set(uuid, jsonb)
  from public, anon, service_role;

grant execute on function
  public.youth_coloring_artwork(uuid, uuid), public.youth_coloring_save(uuid, uuid, uuid, integer, jsonb),
  public.youth_admin_activity_coloring_set(uuid, jsonb)
  to authenticated;
