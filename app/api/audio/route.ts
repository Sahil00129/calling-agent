/**
 * GET /api/audio?id=conv_…
 * Streams the call recording through this server, so the API key never reaches the browser.
 */

import { apiGuard } from "@/lib/auth-server";
import { EL_API, config, keyConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();

  if (id === "" || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return new Response("A conversation id is required", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (!keyConfigured()) {
    return new Response("API key is not configured — add ELEVENLABS_API_KEY to .env.local", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }

  try {
    const upstream = await fetch(`${EL_API}/convai/conversations/${encodeURIComponent(id)}/audio`, {
      headers: { "xi-api-key": config.apiKey, Accept: "audio/mpeg" },
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });

    if (upstream.status !== 200 || !upstream.body) {
      return new Response(`No recording available for this conversation (status ${upstream.status})`, {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        "Accept-Ranges": "none",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "recording fetch failed";
    return new Response(`No recording available (${message})`, {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
