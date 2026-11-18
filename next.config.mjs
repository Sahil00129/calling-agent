/**
 * The browser code (assets/portal.js, assets/app.js) was written against the PHP
 * endpoints (`api/settings.php`, `api/start-batch.php`, ...). Those exact URLs are
 * rewritten here onto the App Router handlers, so the client logic stays untouched.
 */
const ENDPOINTS = [
  'settings',
  'test-connection',
  'upload',
  'recipients',
  'start-batch',
  'campaigns',
  'batch-action',
  'recent',
  'conversations',
  'conversation',
  'audio',
  'phone-numbers',
  'token',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // the legacy page script mutates the DOM; no double-mount
  async rewrites() {
    return ENDPOINTS.map((name) => ({
      source: `/api/${name}.php`,
      destination: `/api/${name}`,
    }));
  },
};

export default nextConfig;
