/**
 * GET /api/phone-numbers -> the outbound numbers configured in ElevenLabs.
 * Required for real phone calls (Twilio native integration or SIP trunk).
 */

import { apiGuard } from "@/lib/auth-server";
import { elRequest, errorResponse, json, upstreamError } from "@/lib/el";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const res = await elRequest("GET", "/convai/phone-numbers");
    if (res.status !== 200) upstreamError(res, "Loading phone numbers");

    // ElevenLabs returns a bare array; older docs show { phone_numbers: [...] } — accept both.
    const payload = res.json ?? [];
    const list = Array.isArray(payload) ? payload : (payload.phone_numbers ?? []);

    const numbers = (Array.isArray(list) ? list : [])
      .filter((number: any) => number && number.phone_number_id)
      .map((number: any) => ({
        phone_number_id: number.phone_number_id,
        phone_number: number.phone_number ?? null,
        label: number.label ?? null,
        provider: number.provider ?? null,
        outbound: Boolean(number.supports_outbound ?? true),
        assigned_agent: number.assigned_agent?.agent_name ?? null,
      }));

    return json({ phone_numbers: numbers });
  } catch (err) {
    return errorResponse(err);
  }
}
