/**
 * Signed-cookie session for the single static account.
 *
 * Runs on the Web Crypto API only, so the same code works in middleware (edge)
 * and in route handlers (node). No database, no server-side session store.
 *
 * Token layout: base64url(JSON payload) "." base64url(HMAC-SHA256)
 */

import { config } from "./config";

export const SESSION_COOKIE = "el_portal";

const encoder = new TextEncoder();

export interface SessionPayload {
  /** username */
  u: string;
  /** issued at (unix seconds) */
  iat: number;
  /** expires at (unix seconds) */
  exp: number;
}

export function sessionTtlSeconds(): number {
  return Math.max(1, config.sessionHours) * 3600;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64url(new Uint8Array(signature));
}

/** Same length, no early exit — keeps the comparison honest. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(user: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { u: user, iat: now, exp: now + sessionTtlSeconds() };
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await sign(body)}`;
}

export async function verifySessionToken(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = await sign(body);
  if (!timingSafeEqual(expected, signature)) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as SessionPayload;
    if (!payload?.u || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = sessionTtlSeconds()) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

/** True once the token is past ~75% of its life, so it can be refreshed. */
export function shouldRefresh(payload: SessionPayload): boolean {
  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  return remaining < sessionTtlSeconds() * 0.75;
}
