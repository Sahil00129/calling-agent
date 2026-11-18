/**
 * One gate for the whole app.
 *
 * - Pages without a session go to /login?next=<path>
 * - API calls without a session get 401 + { reauth: true }, which the legacy
 *   client code already understands (it bounces to the login screen).
 * - Sessions slide: a token past 75% of its life is re-issued on the way through.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  shouldRefresh,
  verifySessionToken,
} from "@/lib/session";

const PUBLIC_PATHS = [/^\/login\/?$/, /^\/api\/auth\/login\/?$/, /^\/api\/auth\/logout\/?$/];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC_PATHS.some((pattern) => pattern.test(pathname))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "Not signed in — your session ended. Please log in again.",
          reauth: true,
          login: "/login",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();

  if (shouldRefresh(session)) {
    const fresh = await createSessionToken(session.u);
    response.cookies.set(SESSION_COOKIE, fresh, sessionCookieOptions());
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|assets/|favicon.ico).*)"],
};
