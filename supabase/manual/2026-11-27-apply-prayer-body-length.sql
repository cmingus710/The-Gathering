-- Prayer Library without a length limit · Apply migration
-- 20261127000100_prayer_body_length to the hosted project.
--
-- Run once in the SQL editor of The Gathering project, ONLY after the owner
-- approves applying it (docs/migration-history.md, "Prayer Library without a
-- length limit"):
--   https://supabase.com/dashboard/project/ymuiutwdnhxdqsetnwkt/sql/new
--
-- Additive: a contributed prayer may be any length. prayer.clean_body is
-- new, public.prayer_library_save (same signature) uses it instead of the
-- 6,000-character community.clean_text call, the body check keeps only its
-- "not empty" half, and prayer.library_reindex indexes the first 100,000
-- characters of the body so the search vector stays under PostgreSQL's 1 MB
-- limit. Every value the old check allowed is still allowed, so no row is
-- rewritten (adding the check re-validates the existing rows). No table,
-- policy, grant, or signature changes.
--
-- It copies supabase/migrations/20261127000100_prayer_body_length.sql
-- verbatim and records it under its repository version (created_by =
-- prayer-body-length). All or nothing: one transaction; out of order or a
-- second run stops at the preflight with "Nothing was changed".
-- It needs the Prayer Library steps (20261115000100 and 20261124000100).
begin;

do $preflight$
begin
  if to_regclass('prayer.library_prayers') is null
     or to_regprocedure('public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid, uuid)') is null
     or not exists (select 1 from pg_constraint where conrelid = 'prayer.library_prayers'::regclass and conname = 'library_prayers_body_check') then
    raise exception 'Nothing was changed: this is not The Gathering database at the expected stage.';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where version in ('20261115000100', '20261124000100')) <> 2 then
    raise exception 'Nothing was changed: the Prayer Library steps (20261115000100 and 20261124000100) are not both recorded. Run the steps in order.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127000100') then
    raise exception 'Nothing was changed: 20261127000100 is already applied.';
  end if;
end
$preflight$;

-- =========================================================================
-- 20261127000100_prayer_body_length.sql
-- =========================================================================
-- Prayer Library · no length limit on the prayer itself (additive).
--
-- Contributed prayers run from a one-line blessing to a long liturgy or a
-- daily prayer that fills several pages, and the 6,000-character ceiling
-- turned those away ("Keep the prayer to 6,000 characters."). The limit is
-- removed everywhere a member meets it:
--
--   * prayer.clean_body(text) is new: the same trim and control-character
--     strip community.clean_text does, and the same "The prayer is too
--     short." refusal for an empty body, with no upper bound. It is private
--     to the prayer schema, like every other helper there.
--   * public.prayer_library_save (same signature, grants unchanged) cleans
--     the body with it instead of community.clean_text(p_body, 1, 6000, …).
--     Every other rule it enforces is unchanged.
--   * the prayer.library_prayers.body check keeps the "not empty" half and
--     drops the 6,000 ceiling. Every value the old check allowed is still
--     allowed, so no row is rewritten or invalidated.
--   * prayer.library_reindex indexes the first 100,000 characters of the
--     body (title, attribution, collection, categories, and Scripture
--     references are indexed whole, as before). A tsvector is capped at
--     1 MB by PostgreSQL, so an unbounded body could otherwise fail the
--     save outright; 100,000 characters is far past any prayer, and the
--     whole body is still stored, shown, and read by members.
--
-- The title, author or source, source link, Scripture references, and
-- category counts keep their limits. No table, policy, grant, signature, or
-- notification changes.

-- ---------------------------------------------------------------------------
-- The body, cleaned without a ceiling
-- ---------------------------------------------------------------------------
create function prayer.clean_body(p text)
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
    raise exception 'The prayer is too short.' using errcode = '22023';
  end if;
  return v;
end;
$$;

alter table prayer.library_prayers drop constraint library_prayers_body_check;
alter table prayer.library_prayers add constraint library_prayers_body_check check (char_length(btrim(body)) >= 1);

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------
-- Unchanged from 20261124000100 except the body, indexed up to 100,000
-- characters so a long prayer can never push the vector past PostgreSQL's
-- 1 MB tsvector limit.
create or replace function prayer.library_reindex(p_prayer uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update prayer.library_prayers l
     set search = setweight(to_tsvector('english', l.title), 'A')
               || setweight(to_tsvector('english', concat_ws(' ',
                    l.source_name,
                    community.display_name(l.contributor_id),
                    (select c.name from prayer.library_collections c where c.id = l.collection_id),
                    (select string_agg(c.name, ' ')
                       from prayer.library_prayer_categories pc
                       join prayer.library_categories c on c.id = pc.category_id
                      where pc.prayer_id = l.id),
                    array_to_string(l.scripture_refs, ' '))), 'B')
               || setweight(to_tsvector('english', left(l.body, 100000)), 'C')
   where l.id = p_prayer;
$$;

-- ---------------------------------------------------------------------------
-- Contributing
-- ---------------------------------------------------------------------------
-- Unchanged from 20261124000100 except v_body, which is no longer capped.
create or replace function public.prayer_library_save(
  p_id uuid, p_title text, p_body text, p_origin text, p_source_name text, p_source_url text,
  p_scripture text[], p_categories uuid[], p_publish boolean, p_client_key uuid default null,
  p_collection uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := prayer.require_member();
  v_title text := community.clean_text(p_title, 3, 120, 'The title');
  v_body text := prayer.clean_body(p_body);
  v_source text := nullif(community.clean_text(coalesce(p_source_name, ''), 0, 200, 'The author or source'), '');
  v_url text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_refs text[];
  v_cats uuid[] := array(select distinct c from unnest(coalesce(p_categories, '{}')) c where c is not null);
  v_publish boolean := coalesce(p_publish, false);
  old prayer.library_prayers;
  v_id uuid;
begin
  if coalesce(p_origin, '') not in ('original', 'shared') then
    raise exception 'Say whether the prayer is your own or shared from another source.' using errcode = '22023';
  end if;
  if v_body ~ '\]\((mention|group):' then
    raise exception 'Mentions aren''t used in the Prayer Library. Remove the @mention and try again.' using errcode = '22023';
  end if;
  if v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https?://[^\s<>"]+$') then
    raise exception 'Enter the source link as a full web address starting with https://.' using errcode = '22023';
  end if;
  select coalesce(array_agg(r order by ord), '{}') into v_refs
    from (select distinct on (lower(btrim(r))) btrim(r) r, ord
            from unnest(coalesce(p_scripture, '{}')) with ordinality u(r, ord)
           where btrim(coalesce(r, '')) <> ''
           order by lower(btrim(r)), ord) x;
  if cardinality(v_refs) > 20 or exists (select 1 from unnest(v_refs) r where char_length(r) > 80) then
    raise exception 'Add up to 20 Scripture references, each a short reference such as “Psalm 23”.' using errcode = '22023';
  end if;
  -- Active categories, or archived ones the prayer already had (it keeps its labels).
  if (select count(*) from prayer.library_categories c
       where c.id = any (v_cats)
         and (c.archived_at is null
              or (p_id is not null and exists (select 1 from prayer.library_prayer_categories pc where pc.prayer_id = p_id and pc.category_id = c.id)))) <> cardinality(v_cats) then
    raise exception 'One of the chosen topics, purposes, or uses is no longer available. Choose again.' using errcode = '22023';
  end if;
  if (select count(*) from prayer.library_categories c where c.id = any (v_cats) and c.kind = 'topic') > 8
     or (select count(*) from prayer.library_categories c where c.id = any (v_cats) and c.kind = 'purpose') > 4
     or (select count(*) from prayer.library_categories c where c.id = any (v_cats) and c.kind = 'use') > 7 then
    raise exception 'Choose up to 8 topics, 4 purposes, and 7 uses.' using errcode = '22023';
  end if;
  if p_collection is not null and not exists (select 1 from prayer.library_collections c where c.id = p_collection and c.archived_at is null) then
    raise exception 'That collection is no longer available. Choose another.' using errcode = '22023';
  end if;
  if v_publish and community.restricted(v_uid, 'posting') then
    raise exception 'Your community posting is paused by a moderator, so you can''t publish right now. You can still save a draft.' using errcode = '42501';
  end if;

  if p_id is null then
    if p_client_key is not null then
      select id into v_id from prayer.library_prayers where contributor_id = v_uid and client_key = p_client_key;
      if v_id is not null then
        return v_id;
      end if;
    end if;
    if v_publish and p_collection is null then
      raise exception 'Choose a collection before publishing.' using errcode = '22023';
    end if;
    perform community.rate_limit(v_uid, 'prayer_library_save', 30, interval '1 hour');
    insert into prayer.library_prayers (contributor_id, title, body, origin, source_name, source_url, scripture_refs,
                                        status, published_at, client_key, collection_id)
    values (v_uid, v_title, v_body, p_origin, v_source, v_url, v_refs,
            case when v_publish then 'published' else 'draft' end, case when v_publish then now() end, p_client_key, p_collection)
    returning id into v_id;
  else
    select * into old from prayer.library_prayers where id = p_id for update;
    if not found or old.contributor_id <> v_uid then
      raise exception 'That prayer wasn''t found.' using errcode = 'P0002';
    end if;
    if old.status = 'archived' then
      raise exception 'Restore this prayer from the archive before editing it.' using errcode = '22023';
    end if;
    if v_publish and p_collection is null then
      raise exception 'Choose a collection before publishing.' using errcode = '22023';
    end if;
    perform community.rate_limit(v_uid, 'prayer_library_save', 30, interval '1 hour');
    v_id := old.id;
    update prayer.library_prayers
       set title = v_title, body = v_body, origin = p_origin, source_name = v_source, source_url = v_url,
           scripture_refs = v_refs, collection_id = p_collection,
           status = case when v_publish then 'published' else 'draft' end,
           -- The first publication date is kept, so editing never moves a prayer to the top.
           published_at = coalesce(published_at, case when v_publish then now() end),
           edited_at = case when old.status = 'published' then now() else edited_at end,
           updated_at = now()
     where id = v_id;
    delete from prayer.library_prayer_categories where prayer_id = v_id;
  end if;
  insert into prayer.library_prayer_categories (prayer_id, category_id)
  select v_id, c from unnest(v_cats) c;
  perform prayer.library_reindex(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- prayer.clean_body stays private, like every helper in the schema; the
-- public function keeps the grants it already has.
revoke execute on all functions in schema prayer from public, anon, authenticated;

-- Expected afterwards: the body check no longer names a ceiling, a 20,000
-- character prayer is kept whole by prayer.clean_body, and the search vector
-- is built from the first 100,000 characters of the body.
do $check$
begin
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'prayer.library_prayers'::regclass and conname = 'library_prayers_body_check')) like '%6000%' then
    raise exception 'Nothing was changed: the prayer body check still caps the length. Send this message to the developer.';
  end if;
  if char_length(prayer.clean_body(repeat('amen ', 4000) || 'amen')) <> 20004 then
    raise exception 'Nothing was changed: a long prayer is not kept whole. Send this message to the developer.';
  end if;
  if pg_get_functiondef(to_regprocedure('prayer.library_reindex(uuid)')) not like '%left(l.body, 100000)%'
     or pg_get_functiondef(to_regprocedure('public.prayer_library_save(uuid, text, text, text, text, text, text[], uuid[], boolean, uuid, uuid)')) not like '%prayer.clean_body(p_body)%' then
    raise exception 'Nothing was changed: the Prayer Library functions were not replaced. Send this message to the developer.';
  end if;
end
$check$;

insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20261127000100', 'prayer_body_length', 'prayer-body-length');

commit;
