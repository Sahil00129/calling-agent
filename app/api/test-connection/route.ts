/**
 * GET /api/test-connection?agent_id=agent_xxx
 *
 * One click health check for the Settings tab: is the API key accepted, does the
 * agent exist, and how many outbound numbers can be dialled from?
 */

import { apiGuard } from "@/lib/auth-server";
import { keyConfigured, keyHint } from "@/lib/config";
import { ApiError, elRequest, errorResponse, json, upstreamError } from "@/lib/el";
import { storeRead } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    if (!keyConfigured()) {
      throw new ApiError(400, "API key is not configured — add ELEVENLABS_API_KEY to .env.local");
    }

    const url = new URL(req.url);
    const settings = await storeRead<Record<string, string>>("settings.json", {});
    const agentId = (url.searchParams.get("agent_id") ?? settings.agent_id ?? "").trim();

    if (agentId === "" || !/^agent_[A-Za-z0-9]+$/.test(agentId)) {
      throw new ApiError(400, "Add a valid agent id first (expected agent_xxxxxxxx)");
    }

    const res = await elRequest("GET", `/convai/agents/${encodeURIComponent(agentId)}`);
    if (res.status === 404) {
      throw new ApiError(404, "That agent was not found in this workspace", { status: 404 });
    }
    if (res.status !== 200) {
      upstreamError(res, "Checking the agent");
    }

    const numbers = await elRequest("GET", "/convai/phone-numbers");
    const phoneNumbers = numbers.status === 200 ? (numbers.json?.phone_numbers ?? []) : [];

    return json({
      ok: true,
      agent: { id: agentId, name: res.json?.name ?? null },
      phone_numbers: Array.isArray(phoneNumbers) ? phoneNumbers.length : 0,
      key_hint: keyHint(),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
