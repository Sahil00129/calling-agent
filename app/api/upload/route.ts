/**
 * POST /api/upload  (multipart/form-data, field: "file")
 *
 * Parses a CSV or XLSX recipient list, stores it, and returns a preview.
 * The only mandatory column is the phone number; every other column becomes a
 * dynamic variable for the agent (name, village, due_amount, ...).
 */

import { apiGuard } from "@/lib/auth-server";
import { ApiError, errorResponse, json } from "@/lib/el";
import { storeWrite } from "@/lib/store";
import { ImportError, MAX_BYTES, buildRecipientPayload } from "@/lib/upload";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");

    if (!(file instanceof File)) {
      throw new ApiError(400, "No file received (field name must be \"file\")");
    }
    if (file.size > MAX_BYTES) {
      throw new ApiError(400, "File is larger than 10 MB");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const payload = buildRecipientPayload(file.name, buffer);

    await storeWrite("recipients.json", payload);

    return json({
      ok: true,
      file: payload.file,
      phone_column: payload.phone_column,
      headers: payload.headers,
      total: payload.total,
      valid: payload.valid,
      skipped: payload.skipped,
      problems: payload.problems,
      truncated: payload.truncated,
      preview: payload.rows.slice(0, 15),
    });
  } catch (err) {
    if (err instanceof ImportError) {
      return json({ error: err.message, ...err.extra }, 400);
    }
    return errorResponse(err);
  }
}
