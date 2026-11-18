/**
 * Recipient list import — CSV and XLSX.
 *
 * Ported 1:1 from api/upload.php, including the stricter phone rules: a bare
 * 10-digit number gets +91, a 12-digit 91 number is accepted, and a value that
 * Excel turned into 9.1822E+11 is rejected (its digits are already gone).
 */

import * as XLSX from "xlsx";

import { analysePhone, type PhoneProblem } from "./phone";

export const MAX_ROWS = 5000;
export const MAX_BYTES = 10 * 1024 * 1024;

export interface ImportProblem {
  line: number;
  value: string;
  reason: PhoneProblem;
}

export interface ImportResult {
  file: string;
  uploaded_at: string;
  phone_column: string;
  headers: string[];
  rows: Record<string, string>[];
  problems: ImportProblem[];
  total: number;
  valid: number;
  skipped: number;
  truncated: boolean;
}

export class ImportError extends Error {
  extra: Record<string, unknown>;

  constructor(message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ImportError";
    this.extra = extra;
  }
}

/* --------------------------------------------------------------- parsing */

/** RFC4180-ish CSV reader with delimiter sniffing, like the PHP fgetcsv version. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));

  let delimiter = ",";
  for (const candidate of [",", ";", "\t", "|"]) {
    const count = firstLine.split(candidate).length - 1;
    if (count > firstLine.split(delimiter).length - 1) delimiter = candidate;
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // swallowed; \n closes the row
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.map((cells) => cells.map((cell) => cell.trim()));
}

export function parseXlsx(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new ImportError("No worksheet found inside the .xlsx file");

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  return matrix.map((cells) => (cells as unknown[]).map((cell) => String(cell ?? "").trim()));
}

/* ---------------------------------------------------------------- build */

const normaliseHeader = (header: string) =>
  header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const PROBLEM_LABELS: Record<PhoneProblem, string> = {
  empty: "blank cell",
  scientific: "saved by Excel in scientific notation, so digits were already rounded away",
  short: "too few digits",
  long: "too many digits",
  india_length: "a 91 number must have 12 digits in total",
  bad: "not a phone number",
};

export function buildRecipientPayload(filename: string, buffer: Buffer): ImportResult {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (!["csv", "txt", "xlsx"].includes(ext)) {
    throw new ImportError(`Unsupported file type .${ext} — save the sheet as .xlsx or .csv`);
  }

  const raw = ext === "xlsx" ? parseXlsx(buffer) : parseCsv(buffer.toString("utf8"));

  if (raw.length < 2) {
    throw new ImportError("The file needs a header row and at least one data row");
  }

  const headers = (raw.shift() as string[]).map(normaliseHeader);

  if (headers.some((header) => header === "")) {
    throw new ImportError("One or more header cells are empty — every column needs a name");
  }

  const rows: Record<string, string>[] = [];
  const rowLines: number[] = [];

  raw.forEach((line, index) => {
    if (rows.length >= MAX_ROWS) return;

    const record: Record<string, string> = {};
    headers.forEach((header, column) => {
      record[header] = String(line[column] ?? "").trim();
    });

    if (Object.values(record).join("") === "") return;

    rows.push(record);
    rowLines.push(index + 2); // +1 header, +1 for 1-based lines
  });

  /* -------------------------------------------------------------- column */

  let phoneColumn: string | null =
    headers.find((header) => /phone|mobile|contact|whatsapp/.test(header)) ?? null;

  if (!phoneColumn) {
    let best: string | null = null;
    let bestScore = 0;

    for (const header of headers) {
      const score = rows.filter((row) => analysePhone(row[header]).phone !== "").length;
      if (score > bestScore) {
        bestScore = score;
        best = header;
      }
    }

    if (best && bestScore > 0) phoneColumn = best;
  }

  if (!phoneColumn) {
    throw new ImportError("No phone column found — add a column named phone_number (or mobile/contact)");
  }

  /* ------------------------------------------------------------ validate */

  const valid: Record<string, string>[] = [];
  const problems: ImportProblem[] = [];

  rows.forEach((row, index) => {
    const rawPhone = String(row[phoneColumn as string] ?? "");
    const result = analysePhone(rawPhone);

    if (result.problem) {
      problems.push({
        line: rowLines[index] ?? index + 2,
        value: rawPhone,
        reason: result.problem,
      });
      return;
    }

    row[phoneColumn as string] = result.phone;
    valid.push(row);
  });

  if (valid.length === 0) {
    const counts = new Map<PhoneProblem, number>();
    for (const problem of problems) counts.set(problem.reason, (counts.get(problem.reason) ?? 0) + 1);

    const parts = [...counts.entries()].map(([reason, count]) => `${count} row(s) — ${PROBLEM_LABELS[reason]}`);

    let message = `No usable phone numbers found in column "${phoneColumn}"`;
    if (parts.length) message += `. ${parts.join("; ")}`;

    const examples = problems
      .slice(0, 3)
      .map((problem) => `line ${problem.line}: "${problem.value}"`);
    if (examples.length) message += `. Fix ${examples.join(", ")}.`;

    if (counts.get("scientific")) {
      message +=
        " Scientific notation is not a phone number — Excel stored a rounded float, so the missing" +
        " digits cannot be recovered. Format the column as Text (or type an apostrophe before the" +
        " number) and enter all 12 digits again, e.g. 919182221100.";
    }

    message += " Correct format: +91XXXXXXXXXX — no spaces, dots or dashes.";

    throw new ImportError(message, { problems: problems.slice(0, 25) });
  }

  return {
    file: filename,
    uploaded_at: new Date().toISOString(),
    phone_column: phoneColumn,
    headers,
    rows: valid,
    problems: problems.slice(0, 50),
    total: rows.length,
    valid: valid.length,
    skipped: problems.length,
    truncated: raw.length > MAX_ROWS,
  };
}
