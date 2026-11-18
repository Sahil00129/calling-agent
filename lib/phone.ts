/**
 * Phone handling — same rules as the PHP build.
 *
 * normPhone()      : quick-call input (10 digits get +91).
 * analysePhone()   : spreadsheet cells, which arrive in every shape Excel can invent.
 * buildRecipients(): rows -> ElevenLabs batch recipients.
 */

import type { Recipient } from "./store";

const DEFAULT_CC = "91";

/** Normalise a number typed by hand. Returns '' when it cannot be used. */
export function normPhone(input: string, defaultCc = DEFAULT_CC): string {
  const value = (input ?? "").trim();
  if (!value) return "";

  let plus = value.startsWith("+");
  let digits = value.replace(/\D+/g, "");
  if (!digits) return "";

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    plus = true;
  }

  if (plus) return digits.length >= 8 ? `+${digits}` : "";

  if (digits.length === 10) return `+${defaultCc}${digits}`;
  return digits.length >= 11 ? `+${digits}` : "";
}

export type PhoneProblem =
  | "empty"
  | "scientific"
  | "short"
  | "long"
  | "india_length"
  | "bad";

export interface PhoneResult {
  phone: string;
  problem: PhoneProblem | null;
}

/**
 * Turn whatever the spreadsheet left in the cell into E.164.
 *
 * Accepted: +918219791047 · 918219791047 · 8219791047 · 08219791047 · 0091 82197 91047
 * Rejected on purpose: 9.1822E+11 — Excel already rounded that to five digits, so the real
 * number is gone and dialling it would call a stranger.
 */
export function analysePhone(raw: unknown): PhoneResult {
  let value = String(raw ?? "")
    .replace(/\uFEFF|\u00A0|\u200B/g, "")
    .trim();

  if (value === "") return { phone: "", problem: "empty" };

  // Scientific notation is only usable when nothing was rounded away.
  if (/^\+?\d+(?:[.,]\d+)?\s*[eE]\s*[+-]?\d+$/.test(value)) {
    const num = Number(value.replace(",", "."));
    if (!Number.isFinite(num)) return { phone: "", problem: "bad" };
    const expanded = BigInt(Math.round(num)).toString();
    if (/0{5,}$/.test(expanded)) return { phone: "", problem: "scientific" };
    value = expanded;
  }

  let plus = false;
  let digits = value.replace(/\D+/g, "");
  if (digits === "") return { phone: "", problem: "bad" };

  if (value.startsWith("+")) {
    plus = true;
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
    plus = true;
  } else if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, ""); // 098765 43210 -> drop the trunk zero
  }

  if (!plus) {
    if (digits.length === 10) {
      digits = `${DEFAULT_CC}${digits}`;
    } else if (digits.startsWith(DEFAULT_CC)) {
      if (digits.length !== 12) return { phone: "", problem: "india_length" };
    } else if (digits.length < 11) {
      return { phone: "", problem: "short" };
    } else if (digits.length > 15) {
      return { phone: "", problem: "long" };
    }
  }

  const phone = `+${digits}`;
  if (!/^\+\d{8,15}$/.test(phone)) return { phone: "", problem: "bad" };
  return { phone, problem: null };
}

/** Spreadsheet rows -> ElevenLabs recipients. limit = 0 means all rows. */
export function buildRecipients(
  rows: Record<string, unknown>[],
  phoneColumn: string,
  limit = 0,
): Recipient[] {
  const out: Recipient[] = [];

  for (const row of rows) {
    if (limit > 0 && out.length >= limit) break;
    if (!row || typeof row !== "object") continue;

    const phone = normPhone(String(row[phoneColumn] ?? ""));
    if (!phone) continue;

    const variables: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === phoneColumn || value === null || value === "") continue;
      variables[key] = value;
    }

    out.push({
      phone_number: phone,
      conversation_initiation_client_data: {
        user_id: phone,
        dynamic_variables: variables,
      },
    });
  }

  return out;
}
