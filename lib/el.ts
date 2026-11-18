/**
 * Small ElevenLabs client. The API key stays on the server — every browser request
 * goes through a route handler, never straight to api.elevenlabs.io.
 */

import { NextResponse } from "next/server";

import { EL_API, config, keyConfigured } from "./config";

export interface ElResponse {
  status: number;
  json: any;
  raw: string;
}

/** An error that already knows which HTTP status the browser should see. */
export class ApiError extends Error {
  status: number;
  extra: Record<string, unknown>;

  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.extra = extra;
  }
}

/** JSON response with the same defaults as the PHP `json_out()`. */
export function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload as any, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Turn a thrown ApiError into the response the old endpoints produced. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return json({ error: err.message, ...err.extra }, err.status);
  }

  // Plain errors may still carry the status they deserve (e.g. 503 for a read-only disk).
  const message = err instanceof Error ? err.message : "Unexpected error";
  const status = Number((err as { status?: number })?.status) || 500;

  return json({ error: message }, status);
}

export async function elRequest(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
  timeoutMs = 30_000,
): Promise<ElResponse> {
  if (!keyConfigured()) {
    throw new ApiError(500, "API key is not configured — add ELEVENLABS_API_KEY to .env.local");
  }

  let url = `${EL_API}${path}`;
  if (query && Object.keys(query).length) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    url += (url.includes("?") ? "&" : "?") + params.toString();
  }

  const headers: Record<string, string> = {
    "xi-api-key": config.apiKey,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });

    const raw = await res.text();
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    return { status: res.status, json: parsed, raw };
  } catch (err) {
    const message = err instanceof Error ? err.message : "request failed";
    return { status: 0, json: null, raw: message };
  }
}

/** Turn an upstream failure into a readable API error. */
export function upstreamError(res: ElResponse, what: string): never {
  let detail: unknown = res.json?.detail ?? null;

  if (Array.isArray(detail) && detail[0]?.msg) {
    detail = detail[0].msg;
  } else if (detail && typeof detail === "object" && "message" in (detail as any)) {
    detail = (detail as any).message;
  }

  let message = `${what} failed`;

  // A read-only key is the most common cause of a 401 here — say what to fix.
  if (res.status === 401 && typeof detail === "string" && detail.includes("convai_write")) {
    message =
      `${what} failed — this API key has no write permission. ` +
      "Add convai_write (ElevenLabs → Settings → API Keys), then update .env.local.";
  }

  throw new ApiError(502, message, {
    status: res.status,
    detail: detail ?? res.raw.slice(0, 800),
  });
}
