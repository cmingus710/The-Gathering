-- Local development seed only (applied by `supabase db reset` on a local stack).
-- Synthetic data: example.test addresses, no real people. Never run in production.
-- Password for every seeded account: Gathering-dev-2026

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'admin@example.test', crypt('Gathering-dev-2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Synthetic Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'editor@example.test', crypt('Gathering-dev-2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Synthetic Editor"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'member@example.test', crypt('Gathering-dev-2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Synthetic Member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated',
   'pending@example.test', crypt('Gathering-dev-2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Synthetic Pending"}', now(), now());

-- Supabase Auth reads these token columns as text and fails on NULL, and
-- email sign-in needs an identity row per user.
update auth.users
   set confirmation_token = coalesce(confirmation_token, ''), recovery_token = coalesce(recovery_token, ''),
       email_change_token_new = coalesce(email_change_token_new, ''), email_change = coalesce(email_change, ''),
       email_change_token_current = coalesce(email_change_token_current, ''), reauthentication_token = coalesce(reauthentication_token, ''),
       phone_change = coalesce(phone_change, ''), phone_change_token = coalesce(phone_change_token, '')
 where email like '%@example.test';
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users where email like '%@example.test'
on conflict do nothing;

select public.bootstrap_super_admin('admin@example.test');
update public.profiles set membership_status = 'approved'
 where id in ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
insert into public.user_roles (user_id, role_key) values ('22222222-2222-4222-8222-222222222222', 'content_editor');

insert into public.announcements (title, body, status, visibility, pinned, publish_at) values
  ('Sample public announcement', 'Synthetic **public** announcement for development.', 'published', 'public', true, now()),
  ('Sample members announcement', 'Synthetic members-only announcement.', 'published', 'members', false, now()),
  ('Sample scheduled announcement', 'Appears one hour after seeding.', 'scheduled', 'members', false, now() + interval '1 hour');
