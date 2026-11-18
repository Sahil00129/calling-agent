/**
 * GET /api/conversations?cursor=…&page_size=30&agent_id=agent_…
 * Lists every conversation in the account (portal calls and dashboard calls alike).
 */

import { apiGuard } from "@/lib/auth-server";
import { elRequest, errorResponse, json, upstreamError } from "@/lib/el";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("page_size") ?? 30) || 30));

    const query: Record<string, string | number> = {
      page_size: pageSize,
      summary_mode: "include",
      sort_direction: "desc",
    };

    const cursor = url.searchParams.get("cursor");
    if (cursor) query.cursor = cursor;

    const agentId = url.searchParams.get("agent_id");
    if (agentId) query.agent_id = agentId;

    const res = await elRequest("GET", "/convai/conversations", undefined, query);
    if (res.status !== 200) upstreamError(res, "Loading conversations");

    const conversations = (res.json?.conversations ?? []).map((conversation: any) => ({
      conversation_id: conversation.conversation_id ?? null,
      agent_id: conversation.agent_id ?? null,
      agent_name: conversation.agent_name ?? null,
      start_time_unix_secs: conversation.start_time_unix_secs ?? null,
      call_duration_secs: conversation.call_duration_secs ?? null,
      status: conversation.status ?? null,
      call_successful: conversation.call_successful ?? null,
      direction: conversation.direction ?? "inbound",
      source: conversation.conversation_initiation_source ?? "unknown",
      message_count: conversation.message_count ?? 0,
      main_language: conversation.main_language ?? null,
      sentiment: conversation.sentiment_analysis?.overall_label ?? null,
      summary: conversation.transcript_summary ?? conversation.call_summary_title ?? null,
      cost_fiat: conversation.cost_fiat ?? null,
      rating: conversation.rating ?? null,
    }));

    return json({
      conversations,
      has_more: Boolean(res.json?.has_more),
      next_cursor: res.json?.next_cursor ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
