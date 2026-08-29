import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Request proxy (Next.js 16's replacement for middleware.ts).
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookie for signed-in admins, so nobody
 *      gets logged out mid-task.
 *   2. Bounce anonymous visitors away from /admin before any admin page code
 *      runs at all.
 *
 * This is the OUTER gate. It is not the only gate — every admin page also
 * calls requireAdmin(), and Postgres row-level security checks again on every
 * write. A middleware-only guard would be one refactor away from bypassed.
 *
 * WHY THE EARLY RETURN BELOW MATTERS:
 * supabase.auth.getUser() is a NETWORK CALL to the Supabase Auth server. This
 * proxy runs on every matched request, including the RSC payload fetches
 * Next.js makes when you click a link. Measured on this project, that call was
 * adding 327-427ms to every single navigation, public pages included — and
 * because an RSC fetch that fails leaves the console with
 * "TypeError: Load failed", a slow or flaky connection turned that latency
 * into visible errors.
 *
 * The public calendar has no session to refresh and nothing to protect, so it
 * should never pay for one. Only /admin routes talk to the Auth server now.
 */

/** Routes that need an authenticated session. Everything else is public. */
function needsAuth(pathname: string): boolean {
  return pathname.startsWith("/admin");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes: no auth check, no network call, no Supabase client.
  if (!needsAuth(pathname)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh and nothing to guard;
  // the pages themselves render a setup screen.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() re-validates the token with Supabase rather than trusting the
  // cookie, which is why it costs a round trip. That is the right trade for an
  // admin route and the wrong one for a public page.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = pathname === "/admin/login";

  if (!isLoginPage && !user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/admin/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  if (isLoginPage && user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/admin";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  // Only /admin needs this proxy at all. Scoping the matcher here means public
  // pages skip the middleware runtime entirely rather than entering it and
  // returning early.
  matcher: ["/admin/:path*"],
};
