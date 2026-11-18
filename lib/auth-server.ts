/**
 * Guards for server components and route handlers.
 * Middleware already blocks anonymous traffic — this is the second line, so a
 * handler can never be reached even if the matcher changes.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { json } from "./el";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export async function currentUser(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = await verifySessionToken(token);
  return payload?.u ?? null;
}

/** For pages: sends the visitor to the sign-in screen. */
export async function requireUser(nextPath: string): Promise<string> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

/** For route handlers: returns a 401 response, or null when the caller is signed in. */
export async function apiGuard(): Promise<Response | null> {
  const user = await currentUser();
  if (user) return null;

  return json(
    {
      error: "Not signed in — your session ended. Please log in again.",
      reauth: true,
      login: "/login",
    },
    401,
  );
}
