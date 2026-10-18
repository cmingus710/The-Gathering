import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["signup", "email", "recovery", "invite", "email_change", "magiclink"];

/**
 * Landing point for links in Supabase Auth emails.
 * Supports the token-hash format (works across devices/browsers) and the PKCE
 * `code` format. The session cookie is set here, then the visitor continues.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin), { status: 303 });

  const supabase = await createClient();
  if (!supabase) return redirectTo("/service-unavailable");

  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) return redirectTo("/sign-in?error=link");
  const next = safeNextPath(url.searchParams.get("next"), "/account-status");
  if (type === "recovery" || next === "/reset-password") return redirectTo("/reset-password");
  return redirectTo(next === "/account-status" ? "/account-status?verified=1" : next);
}
