-- Phase 13 · Lesson builder and private member workbooks.
--
-- A Sunday lesson (media.items, kind 'lesson') can now be built from
-- ordered blocks: an introduction, scripture, teaching, illustrations,
-- images and media from the library, discussion and response questions,
-- reflection, and a closing. Approved adult members who can see the lesson
-- open it as a workbook and write private answers and notes.
--
-- Teacher-only content. Each block has a teacher_note, and a whole block can
-- be marked teacher_only. Neither is ever selected by a member function:
-- members read blocks only through media.lesson_block_member_json, which
-- names its columns one by one and has no teacher fields. The teacher's
-- preview calls the same member function (p_preview = true), so what the
-- preview shows is exactly what members get. The lesson's existing `notes`
-- column is unchanged: it was always shown to members as the lesson's
-- notes (media_item / media.item_detail), and it stays that way. The editor
-- now labels it "Notes shown to members". media.item_detail and
-- public.media_item are not redefined.
--
-- Versioning. Block ids never change: reordering changes `position` only,
-- and a block is never reused for different content. `revision` counts
-- every edit (teachers' optimistic concurrency). `prompt_revision` changes
-- only when a question's wording changes. An answer stores the block id,
-- the prompt_revision it was written against, and a copy of the question
-- as the member saw it; when the wording has changed since, the workbook
-- says so and shows the original. Removing a block is a soft removal
-- (removed_at): answers stay with their block and are shown to their
-- author under "Removed questions". An answer is never moved to another
-- block.
--
-- Answers and workbook notes are private to their author, like the journal:
-- the tables have no grants and no policies, every function acts on the
-- caller's own rows, and there is no teacher, administrator, super
-- administrator, group leader, or guardian path, not even counts. Text is
-- never written to the audit log or notifications.
--
-- Also here, additively: a file used by a lesson block counts as in use
-- (it can't be removed from the library while a block uses it), members
-- who can open the workbook can open files its blocks show, and replacing
-- a library file moves lesson blocks to the replacement like every other
-- reference.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table media.lesson_blocks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references media.items (id) on delete cascade,
  kind text not null check (kind in ('title_intro', 'scripture', 'teaching', 'discussion', 'response', 'illustration', 'image',
                                     'media', 'reflection', 'closing')),
  position integer not null default 0 check (position between 0 and 100000),
  heading text check (char_length(heading) <= 200),
  -- Markdown (the announcement subset; HTML isn't rendered).
  body text not null default '' check (char_length(body) <= 20000),
  -- The question members answer (discussion, response, reflection).
  prompt text check (char_length(prompt) <= 1000),
  -- Canonical reference written by the app ("John 3:16–18").
  scripture_ref text check (char_length(btrim(scripture_ref)) between 1 and 80),
  -- A library file: an image (image blocks) or audio, video, a YouTube or
  -- Vimeo video, or a document (media blocks). Never arbitrary HTML.
  asset_id uuid references media.assets (id) on delete restrict,
  caption text check (char_length(caption) <= 500),
  alt_text text check (char_length(alt_text) <= 500),
  -- Teacher-only: never selected by any member function.
  teacher_only boolean not null default false,
  teacher_note text not null default '' check (char_length(teacher_note) <= 10000),
  revision integer not null default 1 check (revision >= 1),
  prompt_revision integer not null default 1 check (prompt_revision >= 1),
  client_key uuid,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (id, item_id),
  constraint lesson_blocks_scripture check (kind <> 'scripture' or scripture_ref is not null),
  constraint lesson_blocks_asset check ((kind in ('image', 'media')) = (asset_id is not null)),
  constraint lesson_blocks_prompt check (kind not in ('discussion', 'response', 'reflection') or char_length(btrim(coalesce(prompt, ''))) > 0)
);
create index lesson_blocks_item_idx on media.lesson_blocks (item_id, position, created_at);
create index lesson_blocks_asset_idx on media.lesson_blocks (asset_id) where asset_id is not null;
create index lesson_blocks_created_by_idx on media.lesson_blocks (created_by);
create index lesson_blocks_updated_by_idx on media.lesson_blocks (updated_by);
create unique index lesson_blocks_client_key_idx on media.lesson_blocks (item_id, client_key) where client_key is not null;

-- One answer per member per block. The composite key keeps an answer on its
-- own lesson's block.
create table media.workbook_answers (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references media.items (id) on delete cascade,
  block_id uuid not null,
  -- The block's prompt_revision this answer was written against.
  block_revision integer not null check (block_revision >= 1),
  -- The question as the member saw it then.
  prompt_snapshot text not null default '' check (char_length(prompt_snapshot) <= 1000),
  body text not null default '' check (char_length(body) <= 10000),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, block_id),
  foreign key (block_id, item_id) references media.lesson_blocks (id, item_id) on delete cascade
);
create index workbook_answers_item_idx on media.workbook_answers (profile_id, item_id);
create index workbook_answers_block_idx on media.workbook_answers (block_id, item_id);
create index workbook_answers_lesson_idx on media.workbook_answers (item_id);

-- Free private notes, one per member per lesson.
create table media.workbook_notes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references media.items (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 10000),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);
create index workbook_notes_item_idx on media.workbook_notes (item_id);

alter table media.lesson_blocks enable row level security;
alter table media.workbook_answers enable row level security;
alter table media.workbook_notes enable row level security;
revoke all on table media.lesson_blocks, media.workbook_answers, media.workbook_notes from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------
create function media.block_answerable(p_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in ('discussion', 'response', 'reflection');
$$;

-- The block's file, in the shape the workbook renders (no rights or
-- internal fields). Only ready files.
create function media.lesson_block_asset_json(p_asset uuid, p_alt text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'asset_id', a.id, 'kind', a.kind, 'title', a.title, 'mime', a.mime, 'size_bytes', a.size_bytes,
           'duration_seconds', a.duration_seconds, 'width', a.width, 'height', a.height,
           'path', case when a.kind = 'image' then a.path end,
           'variant_path', case when a.kind = 'image' then a.variant_path end,
           'alt', coalesce(nullif(p_alt, ''), a.alt_text, ''),
           'provider', a.provider, 'provider_ref', a.provider_ref, 'provider_hash', a.provider_hash,
           'attribution', a.attribution,
           'captions', coalesce((select jsonb_agg(jsonb_build_object('asset_id', c.id, 'language', c.language,
                                                                     'label', coalesce(c.label, upper(c.language))) order by c.created_at)
                                   from media.assets c where c.parent_id = a.id and c.kind = 'captions' and c.status = 'ready'), '[]'::jsonb))
    from media.assets a
   where a.id = p_asset and a.status = 'ready';
$$;

-- THE member projection of a block. Every column is named here; the
-- teacher_only flag and teacher_note are deliberately absent. Callers pass
-- only blocks that are not removed and not teacher-only.
create function media.lesson_block_member_json(b media.lesson_blocks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'kind', b.kind, 'position', b.position, 'heading', b.heading, 'body', b.body,
    'prompt', case when media.block_answerable(b.kind) then b.prompt end,
    'prompt_revision', b.prompt_revision,
    'answerable', media.block_answerable(b.kind),
    'scripture_ref', b.scripture_ref, 'caption', b.caption,
    'asset', case when b.asset_id is not null then media.lesson_block_asset_json(b.asset_id, b.alt_text) end);
$$;

create function media.lesson_member_blocks(p_item uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(media.lesson_block_member_json(b) order by b.position, b.created_at, b.id), '[]'::jsonb)
    from media.lesson_blocks b
   where b.item_id = p_item and b.removed_at is null and not b.teacher_only;
$$;

-- The caller's answer, with whether its question changed or went away.
create function media.workbook_answer_json(a media.workbook_answers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'block_id', a.block_id, 'body', a.body, 'version', a.version, 'updated_at', a.updated_at,
    'block_revision', a.block_revision, 'prompt_snapshot', a.prompt_snapshot,
    'state', case
               when b.id is null or b.removed_at is not null or b.teacher_only or not media.block_answerable(b.kind) then 'removed'
               when b.prompt_revision <> a.block_revision then 'changed'
               else 'current' end)
    from (select 1) one
    left join media.lesson_blocks b on b.id = a.block_id;
$$;

create function media.workbook_lesson_json(i media.items, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'title', i.title, 'summary', i.summary, 'delivered_on', i.delivered_on, 'audience', i.audience,
    'scripture_refs', to_jsonb(i.scripture_refs),
    'series', (select jsonb_build_object('id', s.id, 'title', s.title) from media.series s where s.id = i.series_id and not s.archived),
    'people', media.people_json(i.id),
    'group_name', (select g.name from community.groups g where g.id = i.group_id and community.group_member(g.id, p_viewer)));
$$;

-- Everything an editor sees about a block (teacher fields included).
create function media.lesson_block_admin_json(b media.lesson_blocks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'kind', b.kind, 'position', b.position, 'heading', b.heading, 'body', b.body, 'prompt', b.prompt,
    'scripture_ref', b.scripture_ref, 'asset_id', b.asset_id, 'caption', b.caption, 'alt_text', b.alt_text,
    'teacher_only', b.teacher_only, 'teacher_note', b.teacher_note,
    'revision', b.revision, 'prompt_revision', b.prompt_revision, 'answerable', media.block_answerable(b.kind),
    'created_at', b.created_at, 'updated_at', b.updated_at, 'removed_at', b.removed_at,
    'updated_by_name', case when b.updated_by is not null then community.display_name(b.updated_by) end,
    'asset', (select jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title, 'status', a.status)
                from media.assets a where a.id = b.asset_id));
$$;

-- A lesson for the builder, locked when p_lock. Editors change drafts;
-- scheduled, published, and archived lessons need content.publish (the
-- same rule as media_admin_item_save).
create function media.lesson_for_builder(p_item uuid, p_lock boolean)
returns media.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  i media.items;
begin
  if p_lock then
    select * into i from media.items where id = p_item and kind = 'lesson' for update;
  else
    select * into i from media.items where id = p_item and kind = 'lesson';
  end if;
  if i.id is null then
    raise exception 'Lesson not found.' using errcode = 'P0002';
  end if;
  if p_lock and i.status <> 'draft' and not public.has_capability('content.publish') then
    raise exception 'Only publishers can change a lesson that is scheduled, published, or archived.' using errcode = '42501';
  end if;
  return i;
end;
$$;

-- ---------------------------------------------------------------------------
-- Teachers (content.edit; changing a live lesson needs content.publish)
-- ---------------------------------------------------------------------------
create function public.media_admin_lesson_blocks(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  i media.items := media.lesson_for_builder(p_item, false);
  v_publisher boolean := public.has_capability('content.publish');
begin
  return jsonb_build_object(
    'lesson', jsonb_build_object('id', i.id, 'title', i.title, 'status', i.status, 'state', media.item_state(i), 'audience', i.audience,
                                 'delivered_on', i.delivered_on, 'publish_at', i.publish_at, 'first_published_at', i.first_published_at,
                                 'group_name', (select g.name from community.groups g where g.id = i.group_id)),
    'can_edit', i.status = 'draft' or v_publisher,
    'can_publish', v_publisher,
    'blocks', coalesce((select jsonb_agg(media.lesson_block_admin_json(b) order by b.position, b.created_at, b.id)
                          from media.lesson_blocks b where b.item_id = i.id and b.removed_at is null), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(media.lesson_block_admin_json(b) order by b.removed_at desc)
                           from media.lesson_blocks b where b.item_id = i.id and b.removed_at is not null), '[]'::jsonb));
end;
$$;

-- Creates (p_block has no id) or updates one block.
--   saved:    {status: 'saved', block}
--   conflict: {status: 'conflict', current: block} when someone else saved
--             it since p_base_revision (nothing is changed)
-- A block's kind is fixed when it is created. Changing a question's wording
-- starts a new prompt_revision, which members who answered see flagged.
create function public.media_admin_lesson_block_save(p_item uuid, p_block jsonb, p_base_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  i media.items := media.lesson_for_builder(p_item, true);
  b media.lesson_blocks;
  v_id uuid := nullif(p_block ->> 'id', '')::uuid;
  v_key uuid := nullif(p_block ->> 'client_key', '')::uuid;
  v_kind text;
  v_heading text;
  v_body text;
  v_prompt text;
  v_ref text;
  v_asset uuid;
  v_caption text;
  v_alt text;
  v_teacher_only boolean;
  v_note text;
  a media.assets;
begin
  if jsonb_typeof(p_block) is distinct from 'object' then
    raise exception 'Invalid block.' using errcode = '22023';
  end if;
  if v_id is not null then
    select * into b from media.lesson_blocks where id = v_id and item_id = i.id for update;
    if b.id is null then
      raise exception 'That block wasn''t found. It may have been deleted.' using errcode = 'P0002';
    end if;
    if b.removed_at is not null then
      raise exception 'That block was removed. Restore it first.' using errcode = '22023';
    end if;
    if b.revision is distinct from p_base_revision then
      return jsonb_build_object('status', 'conflict', 'current', media.lesson_block_admin_json(b));
    end if;
    v_kind := b.kind;
  else
    if v_key is not null then
      select * into b from media.lesson_blocks where item_id = i.id and client_key = v_key;
      if b.id is not null then
        return jsonb_build_object('status', 'saved', 'block', media.lesson_block_admin_json(b));
      end if;
    end if;
    v_kind := p_block ->> 'kind';
    if v_kind is null or v_kind not in ('title_intro', 'scripture', 'teaching', 'discussion', 'response', 'illustration', 'image',
                                        'media', 'reflection', 'closing') then
      raise exception 'Choose what kind of block this is.' using errcode = '22023';
    end if;
    if (select count(*) from media.lesson_blocks where item_id = i.id and removed_at is null) >= 100 then
      raise exception 'A lesson can have at most 100 blocks.' using errcode = '22023';
    end if;
  end if;

  v_heading := case when p_block ? 'heading' then nullif(btrim(p_block ->> 'heading'), '') else b.heading end;
  v_body := case when p_block ? 'body' then coalesce(p_block ->> 'body', '') else coalesce(b.body, '') end;
  v_prompt := case when p_block ? 'prompt' then nullif(btrim(p_block ->> 'prompt'), '') else b.prompt end;
  v_ref := case when p_block ? 'scripture_ref' then nullif(btrim(p_block ->> 'scripture_ref'), '') else b.scripture_ref end;
  v_asset := case when p_block ? 'asset_id' then nullif(p_block ->> 'asset_id', '')::uuid else b.asset_id end;
  v_caption := case when p_block ? 'caption' then nullif(btrim(p_block ->> 'caption'), '') else b.caption end;
  v_alt := case when p_block ? 'alt_text' then nullif(btrim(p_block ->> 'alt_text'), '') else b.alt_text end;
  v_teacher_only := case when p_block ? 'teacher_only' then coalesce((p_block ->> 'teacher_only')::boolean, false) else coalesce(b.teacher_only, false) end;
  v_note := case when p_block ? 'teacher_note' then coalesce(p_block ->> 'teacher_note', '') else coalesce(b.teacher_note, '') end;

  if char_length(coalesce(v_heading, '')) > 200 then
    raise exception 'The heading can be at most 200 characters.' using errcode = '22023';
  end if;
  if char_length(v_body) > 20000 then
    raise exception 'The text can be at most 20,000 characters.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_prompt, '')) > 1000 then
    raise exception 'A question can be at most 1,000 characters.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_caption, '')) > 500 or char_length(coalesce(v_alt, '')) > 500 then
    raise exception 'The caption and description can be at most 500 characters each.' using errcode = '22023';
  end if;
  if char_length(v_note) > 10000 then
    raise exception 'The teacher note can be at most 10,000 characters.' using errcode = '22023';
  end if;
  if not media.block_answerable(v_kind) then
    v_prompt := null;
  elsif v_prompt is null then
    raise exception 'Write the question members will answer.' using errcode = '22023';
  end if;
  if v_kind = 'scripture' then
    if v_ref is null or char_length(v_ref) > 80 then
      raise exception 'Enter a scripture reference, for example John 3:16–18.' using errcode = '22023';
    end if;
  else
    v_ref := null;
  end if;
  if v_kind in ('image', 'media') then
    select * into a from media.assets where id = v_asset;
    if a.id is null or (a.status <> 'ready' and v_asset is distinct from b.asset_id) then
      raise exception 'Choose a ready file from the media library.' using errcode = '22023';
    end if;
    if v_kind = 'image' and a.kind <> 'image' then
      raise exception 'Choose an image.' using errcode = '22023';
    end if;
    if v_kind = 'media' and a.kind not in ('audio', 'video', 'external_video', 'document') then
      raise exception 'Choose audio, a video, or a document.' using errcode = '22023';
    end if;
  else
    v_asset := null;
    v_caption := case when v_kind in ('image', 'media') then v_caption end;
    v_alt := null;
  end if;

  if v_id is null then
    insert into media.lesson_blocks (item_id, kind, position, heading, body, prompt, scripture_ref, asset_id, caption, alt_text,
                                     teacher_only, teacher_note, client_key, created_by, updated_by)
    values (i.id, v_kind,
            coalesce((select max(position) + 1 from media.lesson_blocks where item_id = i.id and removed_at is null), 1),
            v_heading, v_body, v_prompt, v_ref, v_asset, v_caption, v_alt, v_teacher_only, v_note, v_key, v_uid, v_uid)
    returning * into b;
    perform media.audit('media.lesson_block_created', 'media_item', i.id, jsonb_build_object('block', b.id, 'kind', b.kind));
  else
    if v_heading is not distinct from b.heading and v_body = b.body and v_prompt is not distinct from b.prompt
       and v_ref is not distinct from b.scripture_ref and v_asset is not distinct from b.asset_id
       and v_caption is not distinct from b.caption and v_alt is not distinct from b.alt_text
       and v_teacher_only = b.teacher_only and v_note = b.teacher_note then
      return jsonb_build_object('status', 'saved', 'block', media.lesson_block_admin_json(b));
    end if;
    update media.lesson_blocks
       set heading = v_heading, body = v_body, prompt = v_prompt, scripture_ref = v_ref, asset_id = v_asset,
           caption = v_caption, alt_text = v_alt, teacher_only = v_teacher_only, teacher_note = v_note,
           revision = revision + 1,
           prompt_revision = prompt_revision + case when v_prompt is distinct from prompt then 1 else 0 end,
           updated_by = v_uid, updated_at = now()
     where id = b.id
    returning * into b;
    perform media.audit('media.lesson_block_updated', 'media_item', i.id, jsonb_build_object('block', b.id, 'kind', b.kind));
  end if;
  update media.items set updated_by = v_uid, updated_at = now() where id = i.id;
  return jsonb_build_object('status', 'saved', 'block', media.lesson_block_admin_json(b));
end;
$$;

-- Soft removal (answers stay with the block). {status: 'removed'} or a
-- conflict when the block changed since p_base_revision.
create function public.media_admin_lesson_block_remove(p_item uuid, p_block uuid, p_base_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  i media.items := media.lesson_for_builder(p_item, true);
  b media.lesson_blocks;
begin
  select * into b from media.lesson_blocks where id = p_block and item_id = i.id for update;
  if b.id is null then
    raise exception 'That block wasn''t found.' using errcode = 'P0002';
  end if;
  if b.removed_at is not null then
    return jsonb_build_object('status', 'removed', 'block', media.lesson_block_admin_json(b));
  end if;
  if p_base_revision is not null and b.revision <> p_base_revision then
    return jsonb_build_object('status', 'conflict', 'current', media.lesson_block_admin_json(b));
  end if;
  update media.lesson_blocks set removed_at = now(), revision = revision + 1, updated_by = v_uid, updated_at = now()
   where id = b.id returning * into b;
  update media.items set updated_by = v_uid, updated_at = now() where id = i.id;
  perform media.audit('media.lesson_block_removed', 'media_item', i.id, jsonb_build_object('block', b.id, 'kind', b.kind));
  return jsonb_build_object('status', 'removed', 'block', media.lesson_block_admin_json(b));
end;
$$;

-- Puts a removed block back (at the end), with the same id, so answers to
-- it show in members' workbooks again.
create function public.media_admin_lesson_block_restore(p_item uuid, p_block uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  i media.items := media.lesson_for_builder(p_item, true);
  b media.lesson_blocks;
begin
  select * into b from media.lesson_blocks where id = p_block and item_id = i.id for update;
  if b.id is null then
    raise exception 'That block wasn''t found.' using errcode = 'P0002';
  end if;
  if b.removed_at is not null then
    update media.lesson_blocks
       set removed_at = null, revision = revision + 1, updated_by = v_uid, updated_at = now(),
           position = coalesce((select max(position) + 1 from media.lesson_blocks where item_id = i.id and removed_at is null), 1)
     where id = b.id returning * into b;
    update media.items set updated_by = v_uid, updated_at = now() where id = i.id;
    perform media.audit('media.lesson_block_restored', 'media_item', i.id, jsonb_build_object('block', b.id, 'kind', b.kind));
  end if;
  return jsonb_build_object('status', 'saved', 'block', media.lesson_block_admin_json(b));
end;
$$;

-- New order: p_ids must be exactly the lesson's current blocks. Only
-- positions change (ids, revisions, and answers are untouched). Returns
-- {status: 'conflict'} when blocks were added or removed meanwhile.
create function public.media_admin_lesson_blocks_reorder(p_item uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  i media.items := media.lesson_for_builder(p_item, true);
begin
  if p_ids is null or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or coalesce((select array_agg(id order by id) from media.lesson_blocks where item_id = i.id and removed_at is null), '{}')
        <> coalesce((select array_agg(x order by x) from unnest(p_ids) x), '{}') then
    return jsonb_build_object('status', 'conflict');
  end if;
  update media.lesson_blocks b set position = o.n
    from unnest(p_ids) with ordinality o(id, n)
   where b.id = o.id and b.item_id = i.id and b.position is distinct from o.n::integer;
  update media.items set updated_by = v_uid, updated_at = now() where id = i.id;
  perform media.audit('media.lesson_blocks_reordered', 'media_item', i.id, jsonb_build_object('blocks', cardinality(p_ids)));
  return jsonb_build_object('status', 'saved');
end;
$$;

-- ---------------------------------------------------------------------------
-- Members (approved adults who can see the lesson), and the teacher preview
-- ---------------------------------------------------------------------------
-- The workbook: the lesson's member-visible blocks plus the caller's own
-- answers and note. p_preview = true is the editor's preview of the same
-- projection (content.edit; drafts included; no answers).
-- When the lesson is no longer visible, a member who wrote in it still
-- gets their own answers and note (available = false, no lesson content).
create function public.media_lesson_workbook(p_item uuid, p_preview boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  i media.items;
  n media.workbook_notes;
begin
  if coalesce(p_preview, false) then
    v_uid := media.require_cap('content.edit');
    i := media.lesson_for_builder(p_item, false);
    return jsonb_build_object('preview', true, 'available', true, 'lesson', media.workbook_lesson_json(i, v_uid),
                              'blocks', media.lesson_member_blocks(i.id), 'answers', '[]'::jsonb, 'note', null);
  end if;
  v_uid := media.require_member();
  select * into i from media.items where id = p_item and kind = 'lesson';
  select * into n from media.workbook_notes where profile_id = v_uid and item_id = p_item;
  if i.id is null or not media.item_visible(i, v_uid) then
    if n.profile_id is null and not exists (select 1 from media.workbook_answers where profile_id = v_uid and item_id = p_item) then
      raise exception 'Not found.' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object(
    'preview', false,
    'available', i.id is not null and media.item_visible(i, v_uid),
    'lesson', case when media.item_visible(i, v_uid) then media.workbook_lesson_json(i, v_uid) end,
    'blocks', case when media.item_visible(i, v_uid) then media.lesson_member_blocks(i.id) else '[]'::jsonb end,
    'answers', coalesce((select jsonb_agg(media.workbook_answer_json(a) order by a.created_at)
                           from media.workbook_answers a where a.profile_id = v_uid and a.item_id = p_item), '[]'::jsonb),
    'note', case when n.profile_id is not null then jsonb_build_object('body', n.body, 'version', n.version, 'updated_at', n.updated_at) end);
end;
$$;

-- Autosave of one answer against the version the browser edited (0 for a
-- new answer), like journal_entry_save:
--   saved:    {status: 'saved', version, updated_at}
--   conflict: {status: 'conflict', current: {body, version, updated_at}}
-- p_force = true overwrites the newer text (the member chose "keep mine").
create function public.media_workbook_answer_save(p_item uuid, p_block uuid, p_text text, p_base_version integer, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  v_text text := coalesce(p_text, '');
  b media.lesson_blocks;
  a media.workbook_answers;
begin
  if char_length(v_text) > 10000 then
    raise exception 'An answer can be at most 10,000 characters.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'workbook_save', 600, interval '10 minutes');
  if not media.item_visible_id(p_item, v_uid) or not exists (select 1 from media.items where id = p_item and kind = 'lesson') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into b from media.lesson_blocks
   where id = p_block and item_id = p_item and removed_at is null and not teacher_only and media.block_answerable(kind);
  if b.id is null then
    raise exception 'This question is no longer part of the lesson.' using errcode = 'P0002';
  end if;
  select * into a from media.workbook_answers where profile_id = v_uid and block_id = b.id for update;
  if a.profile_id is null then
    if coalesce(p_base_version, 0) <> 0 and not coalesce(p_force, false) then
      -- Deleted in another tab or on another device.
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', '', 'version', 0, 'updated_at', null));
    end if;
    insert into media.workbook_answers (profile_id, item_id, block_id, block_revision, prompt_snapshot, body)
    values (v_uid, p_item, b.id, b.prompt_revision, coalesce(b.prompt, ''), v_text)
    on conflict (profile_id, block_id) do nothing
    returning * into a;
    if a.profile_id is null then
      select * into a from media.workbook_answers where profile_id = v_uid and block_id = b.id;
      if a.body = v_text then
        return jsonb_build_object('status', 'saved', 'version', a.version, 'updated_at', a.updated_at);
      end if;
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', a.body, 'version', a.version, 'updated_at', a.updated_at));
    end if;
    return jsonb_build_object('status', 'saved', 'version', a.version, 'updated_at', a.updated_at);
  end if;
  -- A retried save that already landed.
  if a.version = coalesce(p_base_version, 0) + 1 and a.body = v_text then
    return jsonb_build_object('status', 'saved', 'version', a.version, 'updated_at', a.updated_at);
  end if;
  if a.version <> coalesce(p_base_version, 0) and not coalesce(p_force, false) then
    return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', a.body, 'version', a.version, 'updated_at', a.updated_at));
  end if;
  if a.body = v_text then
    return jsonb_build_object('status', 'saved', 'version', a.version, 'updated_at', a.updated_at);
  end if;
  update media.workbook_answers set body = v_text, version = version + 1, updated_at = now()
   where profile_id = v_uid and block_id = b.id
  returning * into a;
  return jsonb_build_object('status', 'saved', 'version', a.version, 'updated_at', a.updated_at);
end;
$$;

-- The member read the reworded question and keeps their answer for it:
-- the answer now refers to the current wording.
create function public.media_workbook_answer_accept(p_item uuid, p_block uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  b media.lesson_blocks;
  a media.workbook_answers;
begin
  if not media.item_visible_id(p_item, v_uid) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into b from media.lesson_blocks
   where id = p_block and item_id = p_item and removed_at is null and not teacher_only and media.block_answerable(kind);
  if b.id is null then
    raise exception 'This question is no longer part of the lesson.' using errcode = 'P0002';
  end if;
  update media.workbook_answers set block_revision = b.prompt_revision, prompt_snapshot = coalesce(b.prompt, '')
   where profile_id = v_uid and block_id = b.id
  returning * into a;
  if a.profile_id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return media.workbook_answer_json(a);
end;
$$;

-- The member's free notes for the lesson (same autosave contract).
create function public.media_workbook_note_save(p_item uuid, p_text text, p_base_version integer, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
  v_text text := coalesce(p_text, '');
  n media.workbook_notes;
begin
  if char_length(v_text) > 10000 then
    raise exception 'Notes can be at most 10,000 characters.' using errcode = '22023';
  end if;
  perform community.rate_limit(v_uid, 'workbook_save', 600, interval '10 minutes');
  if not media.item_visible_id(p_item, v_uid) or not exists (select 1 from media.items where id = p_item and kind = 'lesson') then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select * into n from media.workbook_notes where profile_id = v_uid and item_id = p_item for update;
  if n.profile_id is null then
    if coalesce(p_base_version, 0) <> 0 and not coalesce(p_force, false) then
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', '', 'version', 0, 'updated_at', null));
    end if;
    insert into media.workbook_notes (profile_id, item_id, body) values (v_uid, p_item, v_text)
    on conflict (profile_id, item_id) do nothing
    returning * into n;
    if n.profile_id is null then
      select * into n from media.workbook_notes where profile_id = v_uid and item_id = p_item;
      if n.body = v_text then
        return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
      end if;
      return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', n.body, 'version', n.version, 'updated_at', n.updated_at));
    end if;
    return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
  end if;
  if n.version = coalesce(p_base_version, 0) + 1 and n.body = v_text then
    return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
  end if;
  if n.version <> coalesce(p_base_version, 0) and not coalesce(p_force, false) then
    return jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('body', n.body, 'version', n.version, 'updated_at', n.updated_at));
  end if;
  if n.body = v_text then
    return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
  end if;
  update media.workbook_notes set body = v_text, version = version + 1, updated_at = now()
   where profile_id = v_uid and item_id = p_item
  returning * into n;
  return jsonb_build_object('status', 'saved', 'version', n.version, 'updated_at', n.updated_at);
end;
$$;

-- The caller's workbooks, most recently written first. A lesson the member
-- can no longer open is listed without its title.
create function public.media_workbooks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'item_id', w.item_id,
             'available', media.item_visible(i, v_uid),
             'title', case when media.item_visible(i, v_uid) then i.title end,
             'delivered_on', case when media.item_visible(i, v_uid) then i.delivered_on end,
             'answers', w.answers, 'has_note', w.has_note, 'updated_at', w.updated_at)
           order by w.updated_at desc)
      from (select x.item_id, sum(x.answers)::integer as answers, bool_or(x.has_note) as has_note, max(x.updated_at) as updated_at
              from (select a.item_id, case when btrim(a.body) <> '' then 1 else 0 end as answers, false as has_note, a.updated_at
                      from media.workbook_answers a where a.profile_id = v_uid
                    union all
                    select n.item_id, 0, btrim(n.body) <> '', n.updated_at
                      from media.workbook_notes n where n.profile_id = v_uid) x
             group by x.item_id
             order by max(x.updated_at) desc
             limit 200) w
      left join media.items i on i.id = w.item_id), '[]'::jsonb);
end;
$$;

-- Deletes the caller's own workbook data for a lesson: one answer
-- (p_block), or every answer and the note (p_block null).
create function public.media_workbook_delete(p_item uuid, p_block uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_member();
begin
  if p_block is not null then
    delete from media.workbook_answers where profile_id = v_uid and item_id = p_item and block_id = p_block;
  else
    delete from media.workbook_answers where profile_id = v_uid and item_id = p_item;
    delete from media.workbook_notes where profile_id = v_uid and item_id = p_item;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Library integration (internal helpers redefined additively)
-- ---------------------------------------------------------------------------
-- Unchanged from 20261025000100 except the last clause: a file shown by a
-- member-visible block of a lesson the person can see, for approved members
-- only (workbooks are members-only, even for a public lesson).
create or replace function media.asset_used_visibly(p_asset uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from media.assets a
     where a.id = p_asset and a.status = 'ready'
       and (exists (select 1 from media.item_media im join media.items i on i.id = im.item_id
                     where im.asset_id = a.id and media.attachment_visible(i, im.members_only, a.public_ok, p_profile))
            or exists (select 1 from media.items i
                        where i.cover_asset_id = a.id and media.attachment_visible(i, false, a.public_ok, p_profile))
            or exists (select 1 from media.shows s
                        where s.artwork_asset_id = a.id and media.show_visible(s, p_profile)
                          and (s.audience <> 'public' or a.public_ok or media.is_member(p_profile)))
            or exists (select 1 from media.series sr
                        where sr.cover_asset_id = a.id
                          and (a.public_ok or media.is_member(p_profile))
                          and exists (select 1 from media.items i where i.series_id = sr.id and media.item_visible(i, p_profile)))
            or exists (select 1 from media.lesson_blocks lb join media.items i on i.id = lb.item_id
                        where lb.asset_id = a.id and lb.removed_at is null and not lb.teacher_only
                          and media.is_member(p_profile) and media.item_visible(i, p_profile))));
$$;

-- Unchanged from 20261025000200 except the last clause: lesson blocks count
-- as uses (so a file can't be removed while a block shows it).
create or replace function media.asset_usage(p_asset uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(u order by u ->> 'title'), '[]'::jsonb) from (
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', im.role) u
      from media.item_media im join media.items i on i.id = im.item_id where im.asset_id = p_asset
    union all
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', 'cover')
      from media.items i where i.cover_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'show', 'id', s.id, 'kind', s.kind, 'title', s.title, 'status', s.status, 'role', 'artwork')
      from media.shows s where s.artwork_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'series', 'id', sr.id, 'kind', sr.scope, 'title', sr.title, 'status', case when sr.archived then 'archived' else 'active' end, 'role', 'cover')
      from media.series sr where sr.cover_asset_id = p_asset
    union all
    select jsonb_build_object('type', 'item', 'id', i.id, 'kind', i.kind, 'title', i.title, 'status', i.status, 'role', 'lesson block')
      from (select distinct lb.item_id from media.lesson_blocks lb where lb.asset_id = p_asset and lb.removed_at is null) x
      join media.items i on i.id = x.item_id
  ) x(u);
$$;

-- Replacing a library file (media_admin_asset_replace) moves lesson blocks
-- to the replacement too.
create function media.lesson_blocks_follow_replacement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update media.lesson_blocks set asset_id = new.replaced_by, updated_at = now() where asset_id = new.id;
  return new;
end;
$$;

create trigger assets_lesson_blocks_follow_replacement
  after update of replaced_by on media.assets
  for each row
  when (new.replaced_by is not null and new.replaced_by is distinct from old.replaced_by)
  execute function media.lesson_blocks_follow_replacement();

-- ---------------------------------------------------------------------------
-- Grants: internal helpers for no one; entry points for signed-in users.
-- ---------------------------------------------------------------------------
revoke execute on function
  media.block_answerable(text), media.lesson_block_asset_json(uuid, text), media.lesson_block_member_json(media.lesson_blocks),
  media.lesson_member_blocks(uuid), media.workbook_answer_json(media.workbook_answers), media.workbook_lesson_json(media.items, uuid),
  media.lesson_block_admin_json(media.lesson_blocks), media.lesson_for_builder(uuid, boolean), media.lesson_blocks_follow_replacement(),
  public.media_admin_lesson_blocks(uuid), public.media_admin_lesson_block_save(uuid, jsonb, integer),
  public.media_admin_lesson_block_remove(uuid, uuid, integer), public.media_admin_lesson_block_restore(uuid, uuid),
  public.media_admin_lesson_blocks_reorder(uuid, uuid[]), public.media_lesson_workbook(uuid, boolean),
  public.media_workbook_answer_save(uuid, uuid, text, integer, boolean), public.media_workbook_answer_accept(uuid, uuid),
  public.media_workbook_note_save(uuid, text, integer, boolean), public.media_workbooks(), public.media_workbook_delete(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.media_admin_lesson_blocks(uuid), public.media_admin_lesson_block_save(uuid, jsonb, integer),
  public.media_admin_lesson_block_remove(uuid, uuid, integer), public.media_admin_lesson_block_restore(uuid, uuid),
  public.media_admin_lesson_blocks_reorder(uuid, uuid[]), public.media_lesson_workbook(uuid, boolean),
  public.media_workbook_answer_save(uuid, uuid, text, integer, boolean), public.media_workbook_answer_accept(uuid, uuid),
  public.media_workbook_note_save(uuid, text, integer, boolean), public.media_workbooks(), public.media_workbook_delete(uuid, uuid)
  to authenticated;
