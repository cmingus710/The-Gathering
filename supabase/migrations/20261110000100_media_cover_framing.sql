-- Media · cover framing per use (additive).
--
-- First written as 20261109000100, renumbered because that version (and
-- 20261109000200) belong to the video migrations merged in #47. The body
-- is unchanged.
--
-- A library image can be the cover of many lessons, devotionals, episodes,
-- books, and series. Until now each place showed it centre-cropped. This
-- stores how the image sits in ITS frame on the item or series that uses
-- it, so repositioning a cover for one lesson never changes the shared
-- library image or any other place that uses it. The image file itself is
-- never changed: the original stays in the media library as uploaded.
--
-- Framing (jsonb, or null for "centred" / "whole cover" for books):
--   {"x": 0–100, "y": 0–100, "zoom": 1–4}
-- x and y mean what CSS object-position means for a covering image (50 =
-- centred); zoom enlarges around that point. The app applies the same
-- framing to every frame shape that shows the cover (square cards, 16:9
-- highlights, the series page), so the chosen point stays in view.
--
-- Changing an item's or series' cover clears its framing (a framing belongs
-- to one image). media_admin_cover_framing_save sets it, for the cover the
-- editor saw, with the same permissions as saving the item or series.
--
-- Nothing else changes: no existing rows are rewritten (framing starts
-- null = centred, exactly the current look), and no existing function
-- changes its signature.

alter table media.items add column cover_framing jsonb;
alter table media.series add column cover_framing jsonb;

-- Validates and normalizes a framing; null stays null.
create function media.clean_framing(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_x numeric;
  v_y numeric;
  v_zoom numeric;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'x') <> 'number' or jsonb_typeof(p -> 'y') <> 'number'
     or (p ? 'zoom' and jsonb_typeof(p -> 'zoom') <> 'number') then
    raise exception 'That image position isn''t valid.' using errcode = '22023';
  end if;
  v_x := (p ->> 'x')::numeric;
  v_y := (p ->> 'y')::numeric;
  v_zoom := coalesce((p ->> 'zoom')::numeric, 1);
  if v_x < 0 or v_x > 100 or v_y < 0 or v_y > 100 or v_zoom < 1 or v_zoom > 4 then
    raise exception 'That image position isn''t valid.' using errcode = '22023';
  end if;
  return jsonb_build_object('x', round(v_x, 1), 'y', round(v_y, 1), 'zoom', round(v_zoom, 3));
end;
$$;

-- Plain expressions (no function call), so any role that may write the row
-- can; CASE keeps the numeric casts behind the type checks.
alter table media.items add constraint items_cover_framing_check check (
  cover_framing is null or case
    when jsonb_typeof(cover_framing) = 'object' and jsonb_typeof(cover_framing -> 'x') = 'number'
         and jsonb_typeof(cover_framing -> 'y') = 'number' and jsonb_typeof(cover_framing -> 'zoom') = 'number'
    then (cover_framing ->> 'x')::numeric between 0 and 100 and (cover_framing ->> 'y')::numeric between 0 and 100
         and (cover_framing ->> 'zoom')::numeric between 1 and 4
    else false end);
alter table media.series add constraint series_cover_framing_check check (
  cover_framing is null or case
    when jsonb_typeof(cover_framing) = 'object' and jsonb_typeof(cover_framing -> 'x') = 'number'
         and jsonb_typeof(cover_framing -> 'y') = 'number' and jsonb_typeof(cover_framing -> 'zoom') = 'number'
    then (cover_framing ->> 'x')::numeric between 0 and 100 and (cover_framing ->> 'y')::numeric between 0 and 100
         and (cover_framing ->> 'zoom')::numeric between 1 and 4
    else false end);

-- A framing belongs to one image: a different cover starts centred again.
create function media.reset_cover_framing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cover_asset_id is distinct from old.cover_asset_id then
    new.cover_framing := null;
  end if;
  return new;
end;
$$;

create trigger items_reset_cover_framing before update of cover_asset_id on media.items
  for each row execute function media.reset_cover_framing();
create trigger series_reset_cover_framing before update of cover_asset_id on media.series
  for each row execute function media.reset_cover_framing();

-- The cover as members and editors see it, now with its framing.
create or replace function media.cover_json(i media.items, p_viewer uuid, p_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('asset_id', a.id, 'path', a.path, 'variant_path', a.variant_path,
                            'alt', coalesce(nullif(i.cover_alt, ''), a.alt_text, ''), 'width', a.width, 'height', a.height,
                            'framing', i.cover_framing)
    from media.assets a
   where a.id = i.cover_asset_id and a.status = 'ready' and a.kind = 'image'
     and (p_admin or i.audience <> 'public' or a.public_ok or media.is_member(p_viewer));
$$;

-- Same as 20261025000300, with the series cover's framing.
create or replace function public.media_series(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s media.series;
  v_items jsonb;
begin
  select * into s from media.series where id = p_id and not archived;
  if s.id is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  select jsonb_agg(media.item_card(i, v_uid) order by media.sort_key(i) desc nulls last) into v_items
    from media.items i where i.series_id = s.id and media.item_visible(i, v_uid);
  if v_items is null then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description, 'scope', s.scope,
    'cover', (select jsonb_build_object('asset_id', a.id, 'path', a.path, 'variant_path', a.variant_path, 'alt', coalesce(a.alt_text, ''),
                                        'framing', s.cover_framing)
                from media.assets a where a.id = s.cover_asset_id and a.status = 'ready' and (a.public_ok or media.is_member(v_uid))),
    'items', v_items);
end;
$$;

-- Same as 20261025000200, with each series' cover framing for the editor.
create or replace function public.media_admin_taxonomy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform media.require_member();
  if not media.is_manager() then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'scope', s.scope, 'title', s.title, 'description', s.description,
                                                            'cover_asset_id', s.cover_asset_id, 'cover_framing', s.cover_framing, 'archived', s.archived,
                                                            'items', (select count(*) from media.items i where i.series_id = s.id))
                                         order by s.archived, s.title) from media.series s), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'archived', p.archived,
                                                            'items', (select count(*) from media.item_people ip where ip.person_id = p.id))
                                         order by p.archived, p.name) from media.people p), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
                                                            'items', (select count(*) from media.item_topics it where it.topic_id = t.id))
                                         order by t.name) from media.topics t), '[]'::jsonb));
end;
$$;

-- Sets the cover framing of one item or one series, after it was saved.
-- Same rules as saving it: content editors, and only publishers once an
-- item is scheduled, published, or archived. p_cover is the cover the
-- editor positioned; if the saved cover is a different image (changed
-- meanwhile), nothing is stored and false is returned.
create function public.media_admin_cover_framing_save(p_item uuid, p_series uuid, p_cover uuid, p_framing jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := media.require_cap('content.edit');
  v_framing jsonb := media.clean_framing(p_framing);
  i media.items;
  s media.series;
begin
  if (p_item is null) = (p_series is null) then
    raise exception 'Choose one item or one series.' using errcode = '22023';
  end if;
  if p_item is not null then
    select * into i from media.items where id = p_item for update;
    if i.id is null then
      raise exception 'Content not found.' using errcode = 'P0002';
    end if;
    if i.status <> 'draft' and not public.has_capability('content.publish') then
      raise exception 'Only publishers can change content that is scheduled, published, or archived.' using errcode = '42501';
    end if;
    if i.cover_asset_id is distinct from p_cover or i.cover_asset_id is null then
      return false;
    end if;
    if i.cover_framing is not distinct from v_framing then
      return true;
    end if;
    update media.items set cover_framing = v_framing, updated_by = v_uid, updated_at = now() where id = i.id;
    perform media.audit('media.cover_framing_saved', 'media_item', i.id, jsonb_build_object('framing', v_framing));
  else
    select * into s from media.series where id = p_series for update;
    if s.id is null then
      raise exception 'Series not found.' using errcode = 'P0002';
    end if;
    if s.cover_asset_id is distinct from p_cover or s.cover_asset_id is null then
      return false;
    end if;
    if s.cover_framing is not distinct from v_framing then
      return true;
    end if;
    update media.series set cover_framing = v_framing, updated_at = now() where id = s.id;
    perform media.audit('media.cover_framing_saved', 'media_series', s.id, jsonb_build_object('framing', v_framing));
  end if;
  return true;
end;
$$;

revoke execute on function media.clean_framing(jsonb), media.reset_cover_framing() from public, anon, authenticated;
revoke execute on function public.media_admin_cover_framing_save(uuid, uuid, uuid, jsonb) from public, anon, service_role;
grant execute on function public.media_admin_cover_framing_save(uuid, uuid, uuid, jsonb) to authenticated;
