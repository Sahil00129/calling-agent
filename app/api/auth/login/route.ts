/**
 * POST /api/auth/login  { username, password }
 *
 * One fixed account (ADMIN_USER / ADMIN_PASS in .env.local). Five wrong passwords
 * inside ten minutes from the same IP are locked out for the rest of the window.
 */

import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { json } from "@/lib/el";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions, sessionTtlSeconds } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1000;

const failures = new Map<string, number[]>();

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] ?? "").trim() || "local";
}

function recentFailures(ip: string): number[] {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (list.length) failures.set(ip, list);
  else failures.delete(ip);
  return list;
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  // Cheap CSRF stop: a cross-site form post carries a foreign Origin.
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host");
    if (!host || new URL(origin).host !== host) {
      return json({ error: "Request blocked — wrong origin." }, 403);
    }
  }

  const ip = clientIp(req);

  const history = recentFailures(ip);
  if (history.length >= MAX_FAILURES) {
    const waitMs = Math.max(0, WINDOW_MS - (Date.now() - history[0]));
    if (waitMs > 0) {
      return json(
        { error: `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(waitMs / 60000))} minute(s).` },
        429,
      );
    }
  }

  let body: { username?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON with username and password." }, 400);
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!username || !password) {
    return json({ error: "Enter both the username and the password." }, 400);
  }

  const userOk = sameSecret(config.adminUser, username);
  const passOk = sameSecret(config.adminPass, password);

  if (!userOk || !passOk) {
    failures.set(ip, [...recentFailures(ip), Date.now()]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return json({ error: "Wrong username or password." }, 401);
  }

  failures.delete(ip);

  const token = await createSessionToken(username);
  const response = NextResponse.json({ ok: true, user: username }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(sessionTtlSeconds()));
  return response;
}
