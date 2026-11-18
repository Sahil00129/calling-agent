/**
 * Server-side token endpoint — the API key never leaves this server.
 *
 * GET /api/token?agent_id=agent_xxx&mode=webrtc    -> { token }
 * GET /api/token?agent_id=agent_xxx&mode=websocket -> { signed_url }
 * GET /api/token?ping=1                            -> { configured, agent_default }
 */

import { apiGuard } from "@/lib/auth-server";
import { EL_API, config, keyConfigured } from "@/lib/config";
import { json } from "@/lib/el";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  const url = new URL(req.url);

  /* --------------------------------------------- health check (test page) */
  if (url.searchParams.get("ping")) {
    return json({ configured: keyConfigured(), agent_default: config.defaultAgentId });
  }

  const agentId = (url.searchParams.get("agent_id") ?? "").trim() || config.defaultAgentId;

  if (agentId === "") {
    return json(
      { error: "agent_id is missing — enter it on the page or set ELEVENLABS_AGENT_ID" },
      400,
    );
  }
  if (!/^agent_[A-Za-z0-9]+$/.test(agentId)) {
    return json({ error: "agent_id looks malformed (expected format: agent_xxx)" }, 400);
  }
  if (!keyConfigured()) {
    return json({ error: "API key is not configured — add ELEVENLABS_API_KEY to .env.local" }, 500);
  }

  const mode = url.searchParams.get("mode") === "websocket" ? "websocket" : "webrtc";
  const endpoint =
    mode === "websocket"
      ? `${EL_API}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`
      : `${EL_API}/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`;

  try {
    const res = await fetch(endpoint, {
      headers: { "xi-api-key": config.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    const raw = await res.text();

    if (res.status !== 200) {
      let detail: unknown = raw.slice(0, 500);
      try {
        detail = JSON.parse(raw);
      } catch {
        /* keep the text */
      }
      return json({ error: "ElevenLabs API error", status: res.status, detail }, 502);
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return json({ error: "Unexpected response from ElevenLabs" }, 502);
    }

    return json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "request failed";
    return json({ error: `Could not reach ElevenLabs: ${message}` }, 502);
  }
}
