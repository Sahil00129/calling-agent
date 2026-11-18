/**
 * GET    /api/recipients -> the imported recipient list
 * DELETE /api/recipients -> clear it
 */

import { apiGuard } from "@/lib/auth-server";
import { errorResponse, json } from "@/lib/el";
import { type RecipientList, storeRead, storeWrite } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard();
  if (guard) return guard;

  const list = await storeRead<RecipientList | null>("recipients.json", null);

  if (!list || !Array.isArray(list.rows) || list.rows.length === 0) {
    return json({ rows: [], headers: [], valid: 0 });
  }

  return json({
    file: list.file ?? null,
    uploaded_at: list.uploaded_at ?? null,
    phone_column: list.phone_column ?? null,
    headers: list.headers ?? [],
    rows: list.rows ?? [],
    total: list.total ?? 0,
    valid: list.valid ?? 0,
    skipped: list.skipped ?? 0,
  });
}

export async function DELETE() {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    await storeWrite("recipients.json", []);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
