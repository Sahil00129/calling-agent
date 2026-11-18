/**
 * Tiny stand-in for Upstash Redis, so the Redis storage path can be tested locally
 * without an account.
 *
 *   node scripts/dev-mock-redis.mjs 4000
 *   KV_REST_API_URL=http://127.0.0.1:4000 KV_REST_API_TOKEN=dev npm run dev
 *
 * Implements just what lib/kv.ts uses: GET /get/<key> and POST /set/<key>.
 */

import http from "node:http";

const port = Number(process.argv[2] ?? 4000);
const store = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const match = url.pathname.match(/^\/(get|set)\/(.+)$/);
  if (!match) return send(404, { error: "unsupported path" });

  const [, verb, rawKey] = match;
  const key = decodeURIComponent(rawKey);

  if (verb === "get") {
    return send(200, { result: store.has(key) ? store.get(key) : null });
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    store.set(key, body);
    send(200, { result: "OK" });
  });
});

server.listen(port, () => {
  console.log(`mock redis listening on http://127.0.0.1:${port}`);
});
