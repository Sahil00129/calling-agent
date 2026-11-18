/**
 * Minimal Upstash Redis client over its REST API — no SDK, no native deps.
 *
 * Used when the app runs on a host with a read-only filesystem (Vercel mounts the
 * bundle at /var/task). Connect a Redis store in the Vercel dashboard and these
 * variables appear automatically:
 *
 *   KV_REST_API_URL / KV_REST_API_TOKEN              (Vercel KV / Marketplace Upstash)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (native Upstash)
 *
 * With neither set, the JSON files under data/ are used (local dev, VPS, Docker).
 */

export interface KvConfig {
  url: string;
  token: string;
}

export function kvConfig(): KvConfig | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function kvEnabled(): boolean {
  return kvConfig() !== null;
}

export async function kvGet(key: string): Promise<string | null> {
  const config = kvConfig();
  if (!config) return null;

  const res = await fetch(`${config.url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Redis read failed (${res.status}) — check the KV environment variables`);
  }

  const body = (await res.json()) as { result?: string | null };
  return body.result ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const config = kvConfig();
  if (!config) return;

  const res = await fetch(`${config.url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "text/plain",
    },
    body: value,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Redis write failed (${res.status}) — check the KV environment variables`);
  }
}
