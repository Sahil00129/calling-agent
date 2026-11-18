/**
 * GET  /api/settings  -> current portal settings + key status
 * POST /api/settings  { agent_id, phone_number_id }
 */

import { apiGuard } from "@/lib/auth-server";
import { keyConfigured, keyHint, keyLooksValid } from "@/lib/config";
import { errorResponse, json } from "@/lib/el";
import { storeRead, storeWrite } from "@/lib/store";

export const dynamic = "force-dynamic";

interface Settings {
  agent_id?: string;
  phone_number_id?: string;
}

export async function GET() {
  const guard = await apiGuard();
  if (guard) return guard;

  const saved = await storeRead<Settings>("settings.json", {});
  const recipients = await storeRead<{ rows?: unknown[] } | unknown[] | null>("recipients.json", null);

  // `Boolean([])` is true in JS — an empty list must read as "no recipients".
  const hasRecipients = Array.isArray(recipients)
    ? recipients.length > 0
    : Boolean(recipients && Array.isArray((recipients as { rows?: unknown[] }).rows)
        ? (recipients as { rows: unknown[] }).rows.length
        : false);

  return json({
    key_configured: keyConfigured(),
    key_valid: keyLooksValid(),
    key_hint: keyHint(),
    agent_id: String(saved.agent_id ?? ""),
    phone_number_id: String(saved.phone_number_id ?? ""),
    has_recipients: hasRecipients,
  });
}

export async function POST(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const input = await req.json().catch(() => ({}));

    const agentId = String(input.agent_id ?? "").trim();
    if (agentId !== "" && !/^agent_[A-Za-z0-9]+$/.test(agentId)) {
      return json({ error: "agent_id looks malformed (expected agent_xxx)" }, 400);
    }

    const saved: Settings = {
      agent_id: agentId,
      phone_number_id: String(input.phone_number_id ?? "").trim(),
    };
    await storeWrite("settings.json", saved);

    return json({ ok: true, settings: saved });
  } catch (err) {
    return errorResponse(err);
  }
}
