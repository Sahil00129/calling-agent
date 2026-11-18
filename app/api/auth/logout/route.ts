/**
 * POST /api/auth/logout
 *
 * POST only (a link or a browser prefetch must never end the session), and the
 * browser is sent back to the sign-in screen with the "signed out" notice.
 */

import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const response = NextResponse.redirect(new URL("/login?signed_out=1", url.origin), 303);

  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
