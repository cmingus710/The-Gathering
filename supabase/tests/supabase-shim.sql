-- Minimal stand-in for the parts of a Supabase database that the migrations
-- depend on, so RLS and authorization can be tested against plain PostgreSQL.
-- Used ONLY by the integration tests (tests/db). Never apply to a real project.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

grant usage on schema public, auth, storage to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email character varying(255),
  raw_user_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz default now()
);

-- Same contract as Supabase: the "sub" claim of the current request JWT.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Hosted Supabase grants broad table privileges by default and relies on RLS.
-- Reproduce that so the migrations' explicit revokes are exercised. Function
-- EXECUTE is left to PostgreSQL's default (PUBLIC), matching what was observed
-- on the hosted project; the migrations grant every function explicitly.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Same contract as Supabase's storage.foldername(): the folder parts of an object name.
create function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Same contract as Supabase Realtime's authorization table and helpers:
-- realtime.send() records a broadcast in realtime.messages, and RLS on that
-- table (with realtime.topic() = the channel being joined) decides who may
-- receive it on a private channel.
create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;
create table realtime.messages (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamp default now(),
  updated_at timestamp default now()
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to anon, authenticated, service_role;
create function realtime.topic() returns text
language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
grant execute on function realtime.topic() to anon, authenticated, service_role;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language sql as $$
  insert into realtime.messages (topic, extension, payload, event, private) values (topic, 'broadcast', payload, event, private)
$$;
