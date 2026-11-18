/**
 * Tiny JSON store — one document per name, exactly like the PHP build's data/*.json.
 *
 * Two backends, chosen by environment:
 *   • Redis (Upstash REST) when KV_REST_API_URL / KV_REST_API_TOKEN exist — needed on
 *     Vercel, where the filesystem is read-only and nothing can be written to /var/task.
 *   • JSON files under DATA_DIR otherwise — local dev, VPS, Docker.
 *
 * Reads are forgiving (a broken document reads as the fallback). File writes go through
 * a temp file + rename so a crash cannot leave half a JSON document.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "./config";
import { kvEnabled, kvGet, kvSet } from "./kv";

const KEY_PREFIX = "elportal:";

export function storageBackend(): "redis" | "file" {
  return kvEnabled() ? "redis" : "file";
}

export function dataDir(): string {
  return path.isAbsolute(config.dataDir)
    ? config.dataDir
    : path.join(process.cwd(), config.dataDir);
}

/** `../../etc/passwd` in a name cannot escape the data folder. */
function safeName(name: string): string {
  return name.replace(/[^a-z0-9_.-]/gi, "");
}

export function dataFile(name: string): string {
  return path.join(dataDir(), safeName(name));
}

export async function storeRead<T>(name: string, fallback: T): Promise<T> {
  const key = safeName(name);

  if (kvEnabled()) {
    try {
      const raw = await kvGet(KEY_PREFIX + key);
      if (!raw || !raw.trim()) return fallback;
      return (JSON.parse(raw) ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  try {
    const raw = await fs.readFile(dataFile(key), "utf8");
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export async function storeWrite(name: string, value: unknown): Promise<void> {
  const key = safeName(name);
  const serialised = JSON.stringify(value, null, 2);

  if (kvEnabled()) {
    await kvSet(KEY_PREFIX + key, serialised); // throws with a readable message on failure
    return;
  }

  const target = dataFile(key);

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, serialised, "utf8");
    await fs.rename(tmp, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";

    if (["EROFS", "EACCES", "EPERM", "ENOENT"].includes(code)) {
      // Serverless hosts mount the bundle read-only, so nothing can be persisted.
      throw Object.assign(
        new Error(
          "This host has a read-only filesystem, so nothing could be saved. " +
            "Add a Redis/KV store (Vercel → Storage → Upstash) so KV_REST_API_URL and " +
            "KV_REST_API_TOKEN are set, then redeploy.",
        ),
        { status: 503, code },
      );
    }
    throw err;
  }
}

/* --------------------------------------------------------------- batches */

export interface BatchSnapshot {
  batch_id: string;
  meta: Record<string, unknown>;
  recipients: Recipient[];
  saved_at: string;
}

const snapshotName = (batchId: string) =>
  `batch-${createHash("sha1").update(batchId).digest("hex")}.json`;

/** Where the recipient snapshot of one batch lives (needed for "Run again"). */
export function batchSnapshotFile(batchId: string): string {
  return dataFile(snapshotName(batchId));
}

export async function storeBatchSnapshot(
  batchId: string,
  recipients: Recipient[],
  meta: Record<string, unknown>,
): Promise<void> {
  const snapshot: BatchSnapshot = {
    batch_id: batchId,
    meta,
    recipients,
    saved_at: new Date().toISOString(),
  };

  await storeWrite(snapshotName(batchId), snapshot);
}

export async function readBatchSnapshot(batchId: string): Promise<BatchSnapshot | null> {
  return storeRead<BatchSnapshot | null>(snapshotName(batchId), null);
}

export async function batchSnapshotExists(batchId: string): Promise<boolean> {
  const snapshot = await readBatchSnapshot(batchId);
  return Boolean(snapshot && Array.isArray(snapshot.recipients));
}

/* ----------------------------------------------------------------- types */

export interface Recipient {
  phone_number: string;
  conversation_initiation_client_data: {
    user_id: string;
    dynamic_variables: Record<string, unknown>;
  };
}

export interface Campaign {
  batch_id: string | null;
  call_name: string;
  agent_id: string;
  number_id: string;
  recipients: number;
  status: string;
  scheduled: number;
  dispatched: number;
  finished: number;
  scheduled_at: number | null;
  created_at: string;
  source_file: string | null;
  phones: string[];
  has_snapshot: boolean;
  checked_at?: string;
}

export interface RecipientList {
  file?: string;
  uploaded_at?: string;
  phone_column?: string;
  headers?: string[];
  rows?: Record<string, unknown>[];
  problems?: { line: number; value: string; reason: string }[];
  total?: number;
  valid?: number;
  skipped?: number;
  truncated?: boolean;
}
