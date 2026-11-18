/**
 * Batch calling — submit a list of recipients to ElevenLabs and remember it here,
 * so the portal can show progress, cancel it, or run it again from the snapshot.
 */

import { ApiError, elRequest, upstreamError } from "./el";
import {
  type Campaign,
  type Recipient,
  storeBatchSnapshot,
  storeRead,
  storeWrite,
} from "./store";

export interface BatchMeta {
  agent_id?: string;
  number_id?: string;
  call_name?: string;
  source_file?: string | null;
  timezone?: string;
  scheduled_time_unix?: number | null;
}

/** `Batch 18 Nov 2026, 10:30` — the same shape the PHP build produced. */
export function defaultBatchName(prefix = "Batch"): string {
  const stamp = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date());

  return `${prefix} ${stamp}`;
}

export async function submitBatch(recipients: Recipient[], meta: BatchMeta): Promise<Campaign> {
  const settings = await storeRead<Record<string, string>>("settings.json", {});

  const agentId = String(meta.agent_id ?? settings.agent_id ?? "").trim();
  const numberId = String(meta.number_id ?? settings.phone_number_id ?? "").trim();
  let callName = String(meta.call_name ?? "").trim();

  if (!/^agent_[A-Za-z0-9]+$/.test(agentId)) {
    throw new ApiError(400, "A valid agent_id is required — add it in Settings");
  }
  if (numberId === "") {
    throw new ApiError(400, "A phone_number_id is required for real phone calls — pick one in Settings");
  }
  if (!recipients.length) {
    throw new ApiError(400, "No usable phone numbers to call");
  }
  if (callName === "") {
    callName = defaultBatchName();
  }

  const payload: Record<string, unknown> = {
    call_name: callName,
    agent_id: agentId,
    agent_phone_number_id: numberId,
    recipients,
  };

  if (meta.scheduled_time_unix) {
    payload.scheduled_time_unix = Number(meta.scheduled_time_unix);
    payload.timezone = meta.timezone ?? "Asia/Kolkata";
  }

  const res = await elRequest("POST", "/convai/batch-calling/submit", payload);
  if (res.status !== 200) {
    upstreamError(res, "Starting the batch call");
  }

  const body = res.json ?? {};
  const batchId = String(body.id ?? "");

  const campaign: Campaign = {
    batch_id: batchId !== "" ? batchId : null,
    call_name: body.name ?? callName,
    agent_id: agentId,
    number_id: numberId,
    recipients: recipients.length,
    status: body.status ?? "pending",
    scheduled: body.total_calls_scheduled ?? recipients.length,
    dispatched: body.total_calls_dispatched ?? 0,
    finished: body.total_calls_finished ?? 0,
    scheduled_at: body.scheduled_time_unix ?? null,
    created_at: new Date().toISOString(),
    source_file: meta.source_file ?? null,
    phones: recipients.slice(0, 5).map((recipient) => recipient.phone_number),
    has_snapshot: false,
  };

  if (batchId !== "") {
    await storeBatchSnapshot(batchId, recipients, {
      agent_id: agentId,
      number_id: numberId,
      call_name: campaign.call_name,
      source_file: meta.source_file ?? null,
    });
    campaign.has_snapshot = true;
  }

  const campaigns = await storeRead<Campaign[]>("campaigns.json", []);
  const list = Array.isArray(campaigns) ? campaigns : [];
  list.unshift(campaign);

  await storeWrite("campaigns.json", list.slice(0, 100));

  return campaign;
}
