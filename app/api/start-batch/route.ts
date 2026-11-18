/**
 * POST /api/start-batch
 *
 * 1. One number (Quick call tab):
 *    { phone: "+919876543210", variables: { customer_name: "Ramesh" }, call_name: "…" }
 * 2. The imported spreadsheet (Excel tab):
 *    { call_name: "…", limit: 25, scheduled_time_unix: null, timezone: "Asia/Kolkata" }
 */

import { apiGuard } from "@/lib/auth-server";
import { submitBatch } from "@/lib/batches";
import { ApiError, errorResponse, json } from "@/lib/el";
import { buildRecipients, normPhone } from "@/lib/phone";
import { type RecipientList, type Recipient, storeRead } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await apiGuard();
  if (guard) return guard;

  try {
    const input = await req.json().catch(() => ({}));
    const settings = await storeRead<Record<string, string>>("settings.json", {});

    const meta = {
      agent_id: String(input.agent_id ?? settings.agent_id ?? "").trim(),
      number_id: String(input.phone_number_id ?? settings.phone_number_id ?? "").trim(),
      call_name: String(input.call_name ?? "").trim(),
      source_file: null as string | null,
      timezone: String(input.timezone ?? "Asia/Kolkata"),
      scheduled_time_unix: input.scheduled_time_unix ? Number(input.scheduled_time_unix) : null,
    };

    /* ------------------------------------------------------- quick call */
    const quickPhone = String(input.phone ?? "").trim();

    if (quickPhone !== "") {
      const phone = normPhone(quickPhone);
      if (phone === "") {
        throw new ApiError(400, "That number does not look valid — try 10 digits or +91XXXXXXXXXX");
      }

      const variables: Record<string, unknown> = {};
      if (input.variables && typeof input.variables === "object") {
        for (const [key, value] of Object.entries(input.variables as Record<string, unknown>)) {
          const name = String(key).trim();
          if (name === "" || value === null || value === "") continue;
          variables[name] = value;
        }
      }

      if (meta.call_name === "") meta.call_name = `Quick call · ${phone}`;

      const recipients: Recipient[] = [
        {
          phone_number: phone,
          conversation_initiation_client_data: { user_id: phone, dynamic_variables: variables },
        },
      ];

      const campaign = await submitBatch(recipients, meta);
      return json({ ok: true, campaign, phone });
    }

    /* -------------------------------------------------------- list mode */
    const list = await storeRead<RecipientList | null>("recipients.json", null);
    if (!list || !Array.isArray(list.rows) || list.rows.length === 0) {
      throw new ApiError(400, "No recipients imported yet — upload a file or use Quick call");
    }

    const phoneColumn = list.phone_column || "phone_number";
    const limit = Math.max(0, Number(input.limit ?? 0));
    const recipients = buildRecipients(list.rows, phoneColumn, limit);

    if (!recipients.length) {
      throw new ApiError(400, "The recipient list has no usable phone numbers");
    }

    meta.source_file = list.file ?? null;
    if (meta.call_name === "") {
      const stamp = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata",
      }).format(new Date());
      meta.call_name = `Batch ${stamp}`;
    }

    const campaign = await submitBatch(recipients, meta);
    return json({ ok: true, campaign });
  } catch (err) {
    return errorResponse(err);
  }
}
