import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Refreshes the auth session and sends signed-out visitors to sign-in before
 * they reach a protected page. This is a convenience layer only: every page,
 * Server Action, and database query re-checks authorization itself.
 */
const PROTECTED_PREFIXES = ["/home", "/announcements", "/directory", "/profile", "/admin", "/account-status"];

export async function proxy(request: NextRequest) {
  const { response, signedIn } = await updateSession(request);
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isProtected) {
    response.headers.set("Cache-Control", "private, no-store");
    if (!signedIn) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      const redirect = NextResponse.redirect(url);
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      redirect.headers.set("Cache-Control", "private, no-store");
      return redirect;
    }
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static build files, images, icons, the service worker, and the manifest.
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|sw.js|offline.html|brand/|icons/).*)",
  ],
};
