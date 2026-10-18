-- Phase 1 · Explicit function privileges and a restored column comment.
--
-- Default EXECUTE privileges on new functions differ between Supabase
-- environments (observed during the 2026-10-18 reconciliation; see
-- docs/migration-history.md). This migration states the intended grants for
-- every Phase 1 function so a fresh database and the hosted project end up
-- identical whatever the platform defaults are. It only grants/revokes
-- privileges and sets a comment; it does not change data or definitions.

-- Trigger functions: never callable directly by any API role.
revoke execute on function
  public.touch_updated_at(),
  public.handle_new_auth_user(),
  public.handle_auth_user_email_change(),
  public.guard_last_super_admin(),
  public.church_settings_before_update(),
  public.church_settings_audit(),
  public.announcements_before_write(),
  public.announcements_audit()
from public, anon, authenticated, service_role;

-- Authorization helpers and admin operations: signed-in users only (each
-- admin function re-checks the caller's capability internally).
revoke execute on function
  public.is_approved_member(),
  public.is_super_admin(),
  public.has_capability(text),
  public.my_capabilities(),
  public.active_super_admin_count(uuid),
  public.admin_set_membership_status(uuid, public.membership_status),
  public.admin_grant_role(uuid, text),
  public.admin_revoke_role(uuid, text)
from public, anon, service_role;
grant execute on function
  public.is_approved_member(),
  public.is_super_admin(),
  public.has_capability(text),
  public.my_capabilities(),
  public.active_super_admin_count(uuid),
  public.admin_set_membership_status(uuid, public.membership_status),
  public.admin_grant_role(uuid, text),
  public.admin_revoke_role(uuid, text)
to authenticated;

-- Signed-out visitors need this only inside announcement RLS evaluation.
grant execute on function public.is_approved_member() to anon;

-- One-time bootstrap: service role only.
revoke execute on function public.bootstrap_super_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(text) to service_role;

comment on column public.profiles.membership_status is
  'Changed only through admin_set_membership_status() or bootstrap_super_admin().';
