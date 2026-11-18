/**
 * GET /api/conversation?id=conv_…
 * Full detail for one call: transcript, metadata, collected data, evaluation.
 */

import { apiGuard } from "@/lib/auth-server";
import { ApiError, elRequest, errorResponse, json, upstreamError } from "@/lib/el";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
    if (id === "" || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new ApiError(400, "A conversation id is required");
    }

    const res = await elRequest("GET", `/convai/conversations/${encodeURIComponent(id)}`);
    if (res.status !== 200) upstreamError(res, "Loading the conversation");

    const data = res.json ?? {};

    const transcript = (data.transcript ?? []).map((turn: any) => ({
      role: turn.role ?? "agent",
      message: turn.message ?? "",
      time: turn.time_in_call_secs ?? null,
    }));

    return json({
      conversation_id: data.conversation_id ?? id,
      agent_id: data.agent_id ?? null,
      status: data.status ?? null,
      has_audio: Boolean(data.has_audio),
      has_user_audio: Boolean(data.has_user_audio),
      metadata: data.metadata ?? null,
      analysis: data.analysis ?? null,
      transcript,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
