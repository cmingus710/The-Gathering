-- Phase 12 · "Report a problem" for the adult pilot.
--
-- A deliberately small feedback channel: an approved member sends a
-- category, a description they type themselves, the app path they were on
-- (no query string or fragment), and whether they're happy to be contacted.
-- Nothing else is collected automatically: no page contents, screenshots,
-- tokens, or full URLs.
--
-- Reports are private to super administrators. The table has no grants and
-- no policies; members submit through public.problem_report_submit and
-- super administrators read and resolve through the two admin functions.
-- Reports are never shown to the community.

create table public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  category text not null check (category in ('sign_in', 'navigation', 'content', 'media', 'notifications', 'privacy', 'other')),
  description text not null check (char_length(btrim(description)) between 10 and 2000),
  -- An app path only: starts with one slash, no scheme, host, query, or fragment.
  page_path text check (page_path is null or (char_length(page_path) <= 200 and page_path ~ '^/([A-Za-z0-9._~%-]+(/[A-Za-z0-9._~%-]+)*/?)?$')),
  contact_ok boolean not null default false,
  status text not null default 'new' check (status in ('new', 'resolved')),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint problem_reports_resolution check ((status = 'resolved') = (resolved_at is not null))
);

create index problem_reports_status_idx on public.problem_reports (status, created_at desc);
create index problem_reports_reporter_idx on public.problem_reports (reporter_id);
create index problem_reports_resolved_by_idx on public.problem_reports (resolved_by);

alter table public.problem_reports enable row level security;
revoke all on table public.problem_reports from public, anon, authenticated;

-- Submit a report. Approved, non-youth members only; at most 5 per hour.
create function public.problem_report_submit(p_category text, p_description text, p_page_path text default null, p_contact_ok boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_path text := nullif(btrim(coalesce(p_page_path, '')), '');
  v_id uuid;
begin
  if v_uid is null or not community.is_member(v_uid) then
    raise exception 'Only approved members can send a report.' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('sign_in', 'navigation', 'content', 'media', 'notifications', 'privacy', 'other') then
    raise exception 'Choose what the problem is about.' using errcode = '22023';
  end if;
  if p_description is null or char_length(btrim(p_description)) < 10 then
    raise exception 'Describe the problem in at least 10 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(p_description)) > 2000 then
    raise exception 'Keep the description to 2,000 characters.' using errcode = '22023';
  end if;
  -- Defense in depth: the app already strips these. Drop anything after ? or #,
  -- and drop the path entirely if it isn't a plain app path.
  if v_path is not null then
    v_path := split_part(split_part(v_path, '#', 1), '?', 1);
    if char_length(v_path) > 200 or v_path !~ '^/([A-Za-z0-9._~%-]+(/[A-Za-z0-9._~%-]+)*/?)?$' then
      v_path := null;
    end if;
  end if;
  perform community.rate_limit(v_uid, 'problem_report', 5, interval '1 hour');

  insert into public.problem_reports (reporter_id, category, description, page_path, contact_ok)
  values (v_uid, p_category, btrim(p_description), v_path, coalesce(p_contact_ok, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- Super administrators: newest first. The reporter's sign-in email is
-- included only when they agreed to be contacted.
create function public.admin_problem_reports(p_status text default 'new', p_limit integer default 100)
returns table (
  id uuid, category text, description text, page_path text, contact_ok boolean, status text,
  created_at timestamptz, resolved_at timestamptz, reporter_name text, reporter_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super administrators can view problem reports.' using errcode = '42501';
  end if;
  return query
    select r.id, r.category, r.description, r.page_path, r.contact_ok, r.status, r.created_at, r.resolved_at,
           coalesce(nullif(p.full_name, ''), 'A member')::text,
           (case when r.contact_ok then p.email end)::text
      from public.problem_reports r
      left join public.profiles p on p.id = r.reporter_id
     where p_status is null or r.status = p_status
     order by r.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

create function public.admin_problem_report_set_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.is_super_admin() then
    raise exception 'Only super administrators can change problem reports.' using errcode = '42501';
  end if;
  if p_status not in ('new', 'resolved') then
    raise exception 'That status isn''t available.' using errcode = '22023';
  end if;
  update public.problem_reports
     set status = p_status,
         resolved_at = case when p_status = 'resolved' then now() end,
         resolved_by = case when p_status = 'resolved' then v_uid end
   where id = p_id;
  if not found then
    raise exception 'That report wasn''t found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.problem_report_submit(text, text, text, boolean) from public, anon, service_role;
revoke execute on function public.admin_problem_reports(text, integer) from public, anon, service_role;
revoke execute on function public.admin_problem_report_set_status(uuid, text) from public, anon, service_role;
grant execute on function public.problem_report_submit(text, text, text, boolean) to authenticated;
grant execute on function public.admin_problem_reports(text, integer) to authenticated;
grant execute on function public.admin_problem_report_set_status(uuid, text) to authenticated;
