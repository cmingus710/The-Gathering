import { NextResponse, type NextRequest } from "next/server";
import { classifyOAuthError, isOAuthProvider, type OAuthErrorKind } from "@/lib/auth/oauth";
import { safeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Supabase Auth sends people back after Google or Apple (the
 * "Supabase-to-app" redirect URL). Exchanges the PKCE code for a session, or
 * explains what went wrong (cancelled, expired, already linked elsewhere).
 *
 * Membership is never decided here: new accounts were created pending by the
 * database trigger, and every page re-checks status, so pending and suspended
 * accounts only ever reach the account status page.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const params = url.searchParams;
  const intent = params.get("intent") === "link" ? "link" : "sign-in";
  const provider = isOAuthProvider(params.get("provider")) ? params.get("provider")! : null;
  const next = safeNextPath(params.get("next"));

  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, url.origin), { status: 303 });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  const fail = (kind: OAuthErrorKind) => {
    const target = new URLSearchParams({ oauth_error: kind });
    if (provider) target.set("provider", provider);
    if (intent === "link") return go(`/profile/sign-in-methods?${target}`);
    if (next !== "/home") target.set("next", next);
    return go(`/sign-in?${target}`);
  };

  // The provider or Supabase Auth reported a problem (e.g. the person cancelled).
  if (params.has("error") || params.has("error_code")) {
    return fail(
      classifyOAuthError({ error: params.get("error"), code: params.get("error_code"), description: params.get("error_description") }),
    );
  }

  const code = params.get("code");
  if (!code) return fail("expired");

  const supabase = await createClient();
  if (!supabase) return go("/service-unavailable");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return fail(classifyOAuthError({ code: error?.code, description: error?.message, name: error?.name }));
  }

  if (intent === "link") {
    return go(provider ? `/profile/sign-in-methods?linked=${provider}` : "/profile/sign-in-methods");
  }

  // New Google/Apple accounts may arrive without a name (Apple never sends one
  // on the web): ask for it before anything else.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, membership_status")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profile && profile.membership_status !== "suspended" && !profile.full_name?.trim()) {
    return go(next === "/home" ? "/complete-profile" : `/complete-profile?next=${encodeURIComponent(next)}`);
  }
  return go(next);
}
