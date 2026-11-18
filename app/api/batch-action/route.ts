/**
 * POST /api/batch-action
 * { batch_id, action: "rerun" }  -> submits the same recipients again as a NEW batch
 * { batch_id, action: "cancel" } -> cancels the remaining queued calls
 *
 * A finished ElevenLabs batch cannot be restarted in place, so "rerun" replays the
 * snapshot this portal saved when the first one was started.
 */

import { apiGuard } from "@/lib/auth-server";
import { submitBatch } from "@/lib/batches";
import { ApiError, elRequest, errorResponse, json, upstreamError } from "@/lib/el";
import { type Campaign, readBatchSnapshot, storeRead, storeWrite } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const input = await req.json().catch(() => ({}));
    const batchId = String(input.batch_id ?? "").trim();
    const action = String(input.action ?? "").trim();

    if (batchId === "" || !/^[A-Za-z0-9_-]+$/.test(batchId)) {
      throw new ApiError(400, "A batch_id is required");
    }

    /* ------------------------------------------------------------ cancel */
    if (action === "cancel") {
      const res = await elRequest("POST", `/convai/batch-calling/${encodeURIComponent(batchId)}/cancel`);
      if (res.status !== 200) {
        upstreamError(res, "Cancelling the batch");
      }

      const campaigns = await storeRead<Campaign[]>("campaigns.json", []);
      const list = Array.isArray(campaigns) ? campaigns : [];
      for (const campaign of list) {
        if (campaign.batch_id === batchId) campaign.status = res.json?.status ?? "cancelled";
      }
      await storeWrite("campaigns.json", list);

      return json({ ok: true, status: res.json?.status ?? "cancelled" });
    }

    /* ------------------------------------------------------------- rerun */
    if (action === "rerun") {
      const snapshot = await readBatchSnapshot(batchId);
      if (!snapshot || !snapshot.recipients?.length) {
        throw new ApiError(
          400,
          "This batch was not started from the portal, so its number list is not stored. " +
            "Start it again from the Excel tab.",
        );
      }

      const meta = { ...(snapshot.meta ?? {}) } as Record<string, unknown>;
      const stamp = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata",
      }).format(new Date());

      meta.call_name = `${String(meta.call_name ?? "Batch")} — re-run ${stamp}`;

      const campaign = await submitBatch(snapshot.recipients, meta);
      return json({ ok: true, campaign });
    }

    throw new ApiError(400, 'Unknown action — use "rerun" or "cancel"');
  } catch (err) {
    return errorResponse(err);
  }
}
