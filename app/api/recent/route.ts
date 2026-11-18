/**
 * GET    /api/recent -> numbers called from this portal, newest first
 * POST   /api/recent { phone, label } -> remember one
 * DELETE /api/recent -> clear the list
 *
 * Local only (data/recent.json), so a repeat call is one click, not a new upload.
 */

import { apiGuard } from "@/lib/auth-server";
import { ApiError, errorResponse, json } from "@/lib/el";
import { normPhone } from "@/lib/phone";
import { storeRead, storeWrite } from "@/lib/store";

export const dynamic = "force-dynamic";

const RECENT_MAX = 25;

interface Recent {
  phone: string;
  label: string;
  at: string;
}

export async function GET() {
  const guard = await apiGuard();
  if (guard) return guard;

  const list = await storeRead<Recent[]>("recent.json", []);
  return json({ numbers: Array.isArray(list) ? list : [] });
}

export async function POST(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const input = await req.json().catch(() => ({}));
    const phone = normPhone(String(input.phone ?? ""));

    if (phone === "") throw new ApiError(400, "A valid phone number is required");

    let label = String(input.label ?? "").trim();
    if (label.length > 80) label = label.slice(0, 80);

    const list = await storeRead<Recent[]>("recent.json", []);
    const kept = (Array.isArray(list) ? list : []).filter((item) => item.phone !== phone);

    kept.unshift({ phone, label, at: new Date().toISOString() });

    const trimmed = kept.slice(0, RECENT_MAX);
    await storeWrite("recent.json", trimmed);

    return json({ ok: true, numbers: trimmed });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    await storeWrite("recent.json", []);
    return json({ ok: true, numbers: [] });
  } catch (err) {
    return errorResponse(err);
  }
}
