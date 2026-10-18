import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/env";

/**
 * Signs out and tells the browser to drop cached responses for this site
 * (Clear-Site-Data), so nothing private can be revisited from caches after
 * sign-out. POST only, and same-origin only.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const response = NextResponse.redirect(new URL("/sign-in?signed_out=1", request.nextUrl.origin), { status: 303 });
  response.headers.set("Clear-Site-Data", '"cache"');
  response.headers.set("Cache-Control", "no-store");

  const config = getSupabasePublicConfig();
  if (config) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
        },
      },
    });
    await supabase.auth.signOut({ scope: "local" });
  }
  // Belt and braces: expire any remaining Supabase auth cookies.
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-") && !response.cookies.get(cookie.name)) {
      response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
  }
  return response;
}

export function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
