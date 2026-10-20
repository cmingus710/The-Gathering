import { NextResponse, type NextRequest } from "next/server";
import { WEBHOOK_PATH, webhookHost } from "@/lib/giving/config";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Refreshes the auth session and sends signed-out visitors to sign-in before
 * they reach a protected page. This is a convenience layer only: every page,
 * Server Action, and database query re-checks authorization itself.
 */
const PROTECTED_PREFIXES = [
  "/home",
  "/announcements",
  "/directory",
  "/profile",
  "/giving",
  "/admin",
  "/account-status",
  "/community",
  "/groups",
  "/messages",
  "/notifications",
  "/prayer",
  "/design",
];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The dedicated webhook hostname (publicly reachable so Stripe can deliver
  // events) serves the Stripe webhook and nothing else.
  const host = request.headers.get("host")?.split(":")[0].toLowerCase();
  const hookHost = webhookHost();
  if (hookHost && host === hookHost && pathname !== WEBHOOK_PATH) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  // The webhook, the signed events job, and calendar feeds carry no session;
  // skip session handling (and its cookies) for them.
  if (pathname === WEBHOOK_PATH || pathname === "/api/jobs/events" || pathname.startsWith("/api/calendar/")) {
    return NextResponse.next();
  }

  const { response, signedIn } = await updateSession(request);
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Community API responses are per-member and must never be cached publicly.
  if (pathname.startsWith("/api/community/")) response.headers.set("Cache-Control", "private, no-store");

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
