# ElevenLabs voice portal — Next.js build

Same product as `../elevenlabs-agent-test` (quick calls, spreadsheet campaigns, calls &
recordings, test harness, login), now running on Next.js App Router instead of PHP.

No PHP, no Apache. One Node process serves the pages and the API.

```
elevenlabs-agent-next/
├─ app/
│  ├─ page.tsx                  # the portal (login required)
│  ├─ test/page.tsx             # widget / SDK test harness
│  ├─ login/                    # sign-in screen (page + client form + css)
│  └─ api/                      # one route handler per old PHP endpoint
├─ components/
│  ├─ LegacyPage.tsx            # injects the page markup, then boots its module
│  ├─ account.ts                # the signed-in chip in the top bar
│  └─ markup/portal.html        # page markup extracted from the PHP build
│  └─ markup/test.html
├─ lib/
│  ├─ config.ts                 # env → typed config
│  ├─ session.ts                # signed cookie (Web Crypto, no deps)
│  ├─ auth-server.ts            # page + route guards
│  ├─ store.ts                  # JSON store (data/*.json)
│  ├─ el.ts                     # ElevenLabs client + error mapping
│  ├─ phone.ts                  # E.164 rules + recipient builder
│  ├─ batches.ts                # submit batch, snapshot, campaign record
│  └─ upload.ts                 # CSV / XLSX import (SheetJS)
├─ public/assets/               # portal.js, app.js, portal.css (unchanged logic)
├─ data/                        # JSON store, same files as before
├─ middleware.ts                # the auth gate for every route
└─ scripts/extract-markup.mjs   # pulls markup out of the PHP pages
```

## 1. Run

```powershell
cd C:\xampp\htdocs\elevenlabs-agent-next
npm install
npm run dev          # http://localhost:3000  (hot reload)
```

Production:

```powershell
npm run build
npm start            # http://localhost:3000
```

XAMPP Apache is no longer needed for this app — but keep it if you still host the PHP one.

## 2. Configure

Everything lives in `.env.local` (already created):

| Variable | Meaning |
|---|---|
| `ELEVENLABS_API_KEY` | server-side key, never sent to the browser |
| `ELEVENLABS_AGENT_ID` | optional default agent (Settings tab overrides it) |
| `ADMIN_USER` / `ADMIN_PASS` | the single login account (`admin` / `admin@123`) |
| `SESSION_SECRET` | signs the session cookie — **change before going online** |
| `SESSION_HOURS` | idle timeout, default 8 |
| `DATA_DIR` | JSON store folder, default `data` |

Then open the portal → **Settings**: paste the Agent ID, pick the outbound number, **Save**,
**Test connection**.

## 3. How the port works

**The browser code is unchanged.** `public/assets/portal.js` and `app.js` still call
`api/settings.php`, `api/upload.php`, … — `next.config.mjs` rewrites those exact URLs onto
the new handlers:

```
/api/settings.php  →  app/api/settings        /api/start-batch.php →  app/api/start-batch
/api/upload.php    →  app/api/upload          /api/token.php       →  app/api/token
… 13 endpoints in total, same JSON in and out, same error messages.
```

**The markup is unchanged.** `components/markup/portal.html` is the old page body,
extracted by `scripts/extract-markup.mjs`. `LegacyPage` injects it and then loads the page
module, so the script finds the same ids it always did. Only the account chip is React.

**What was rewritten for real:** the API layer (PHP curl → `fetch`), the JSON store
(`file_get_contents` → `fs/promises`), XLSX/CSV parsing (custom PHP → SheetJS), and auth
(PHP session → HMAC-signed cookie verified in middleware).

| Old | New |
|---|---|
| `config.php` | `.env.local` + `lib/config.ts` |
| `auth.php` (PHP session) | `lib/session.ts` + `middleware.ts` (signed cookie, 8 h slide) |
| `login.php` / `logout.php` | `/login`, `POST /api/auth/logout` (POST-only, like before) |
| `api/*.php` | `app/api/*/route.ts` |
| `data/*.json` | same files, same shapes |
| `portal.html` / `index.html` redirects | `/`, `/test` |

Deliberate behaviour kept: 5 wrong passwords in 10 minutes locks that IP out; every API
call without a session returns `401 {reauth:true}` and the UI bounces to `/login`; sessions
end after 8 h of inactivity; `9.1822E+11` in a phone column is still rejected with the exact
line number (its digits are already lost).

## 4. Changing things later

- **A page looks wrong / needs a new field** → edit the React page + the markup file, or the
  legacy JS in `public/assets`.
- **The API contract changes** → edit the route handler; the `.php` rewrite keeps old
  callers working.
- **The PHP pages change** → re-run `node scripts/extract-markup.mjs` and review the diff.
- **Converting the UI to React** is the natural next step (`portal.js` is a 1000-line DOM
  script); the API layer is ready for it.

## 5. Before you put this online

- Change `ADMIN_PASS` and `SESSION_SECRET`, set `NODE_ENV=production` (cookies become
  `Secure`, so serve it over HTTPS).
- The JSON store writes to a local folder — fine on a VPS, **not** on a read-only/serverless
  filesystem. Use a database if you deploy to a platform without a disk.
- The login rate limit lives in process memory, so it resets on restart and is per instance.
- Same compliance rules as before: outbound calling needs consent, a calling window and
  DND/TRAI compliance. Do not dial purchased lists.
