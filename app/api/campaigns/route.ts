/**
 * GET /api/campaigns           -> batches started from this portal (newest first)
 * GET /api/campaigns?refresh=1 -> same list, with live status pulled from ElevenLabs
 */

import { apiGuard } from "@/lib/auth-server";
import { keyConfigured } from "@/lib/config";
import { elRequest, errorResponse, json } from "@/lib/el";
import { type Campaign, batchSnapshotExists, storeRead, storeWrite } from "@/lib/store";

export const dynamic = "force-dynamic";

const FINAL_STATES = ["completed", "failed", "cancelled"];

export async function GET(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const campaigns = await storeRead<Campaign[]>("campaigns.json", []);
    const list: Campaign[] = Array.isArray(campaigns) ? campaigns : [];

    const refresh = Boolean(url.searchParams.get("refresh")) && keyConfigured();
    let changed = false;

    if (refresh) {
      let checked = 0;

      for (const campaign of list) {
        if (checked >= 15) break; // only keep the newest 15 in sync
        const batchId = String(campaign.batch_id ?? "");
        if (batchId === "") continue;
        if (FINAL_STATES.includes(campaign.status ?? "")) continue;

        const res = await elRequest("GET", `/convai/batch-calling/${encodeURIComponent(batchId)}`);
        checked++;
        if (res.status !== 200 || !res.json) continue;

        campaign.status = res.json.status ?? campaign.status ?? "pending";
        campaign.scheduled = res.json.total_calls_scheduled ?? campaign.scheduled ?? 0;
        campaign.dispatched = res.json.total_calls_dispatched ?? 0;
        campaign.finished = res.json.total_calls_finished ?? 0;
        campaign.checked_at = new Date().toISOString();
        changed = true;
      }

      if (changed) await storeWrite("campaigns.json", list);
    }

    for (const campaign of list) {
      const batchId = String(campaign.batch_id ?? "");
      campaign.has_snapshot = batchId !== "" && (await batchSnapshotExists(batchId));
    }

    return json({ campaigns: list, refreshed: refresh });
  } catch (err) {
    return errorResponse(err);
  }
}
