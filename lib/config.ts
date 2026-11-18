/**
 * Server-side configuration. Values come from .env.local — nothing here may be
 * imported into a client component (the API key must never reach the browser).
 */

export const EL_API = "https://api.elevenlabs.io/v1";

const env = (key: string, fallback = "") => (process.env[key] ?? fallback).trim();

export const config = {
  apiKey: env("ELEVENLABS_API_KEY"),
  defaultAgentId: env("ELEVENLABS_AGENT_ID"),

  adminUser: env("ADMIN_USER", "admin") || "admin",
  adminPass: env("ADMIN_PASS", "admin@123") || "admin@123",

  sessionSecret: env("SESSION_SECRET", "dev-only-change-me"),
  sessionHours: Number(env("SESSION_HOURS", "8")) || 8,

  dataDir: env("DATA_DIR", "data") || "data",
};

/** A key is present and is not the shipped placeholder. */
export function keyConfigured(): boolean {
  const key = config.apiKey;
  return key !== "" && !key.includes("PASTE_YOUR_API_KEY_HERE");
}

/** ElevenLabs keys start with sk_ — catches dummy values before they reach the API. */
export function keyLooksValid(): boolean {
  return keyConfigured() && /^sk_[A-Za-z0-9_-]{8,}$/.test(config.apiKey);
}

/** First characters only, so the Settings tab can show which key is loaded. */
export function keyHint(): string | null {
  return keyConfigured() ? `${config.apiKey.slice(0, 6)}…` : null;
}
