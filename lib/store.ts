/**
 * Tiny JSON store — the same `data/*.json` files the PHP version used.
 * Reads are cheap and forgiving (a broken file reads as the fallback), writes go
 * through a temp file + rename so a crash cannot leave half a JSON document.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "./config";

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
  try {
    const raw = await fs.readFile(dataFile(name), "utf8");
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export async function storeWrite(name: string, value: unknown): Promise<void> {
  const target = dataFile(name);
  await fs.mkdir(path.dirname(target), { recursive: true });

  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, target);
}

/* --------------------------------------------------------------- batches */

export interface BatchSnapshot {
  batch_id: string;
  meta: Record<string, unknown>;
  recipients: Recipient[];
  saved_at: string;
}

/** Where the recipient snapshot of one batch lives (needed for "Run again"). */
export function batchSnapshotFile(batchId: string): string {
  const hash = createHash("sha1").update(batchId).digest("hex");
  return dataFile(`batch-${hash}.json`);
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
  await storeWrite(`batch-${createHash("sha1").update(batchId).digest("hex")}.json`, snapshot);
}

export async function readBatchSnapshot(batchId: string): Promise<BatchSnapshot | null> {
  try {
    const raw = await fs.readFile(batchSnapshotFile(batchId), "utf8");
    return JSON.parse(raw) as BatchSnapshot;
  } catch {
    return null;
  }
}

export async function batchSnapshotExists(batchId: string): Promise<boolean> {
  try {
    await fs.access(batchSnapshotFile(batchId));
    return true;
  } catch {
    return false;
  }
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
