/**
 * Pull the page markup out of the PHP build so the Next app renders byte-identical
 * HTML (same classes, same ids). The page logic stays in public/assets/*.js and is
 * loaded by a small client component afterwards.
 *
 *   node scripts/extract-markup.mjs [path-to-php-project]
 *
 * Only needs re-running if the PHP pages change.
 */

import fs from "node:fs";
import path from "node:path";

const phpRoot = path.resolve(
  process.argv[2] ?? path.join(process.cwd(), "..", "elevenlabs-agent-test"),
);

const outDir = path.join(process.cwd(), "components", "markup");
fs.mkdirSync(outDir, { recursive: true });

/** Drop the leading <?php ... ?> block. */
const stripPhp = (source) => source.replace(/^<\?php[\s\S]*?\?>\s*/i, "");

const headStyles = (source) => {
  const head = source.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  return [...head.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].map((match) => match[0]).join("\n");
};

const bodyOf = (source) => source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";

/** Scripts are loaded by the React shell, never injected as markup. */
const stripScripts = (html) =>
  html
    .replace(/<script[^>]*\bsrc=[^>]*>\s*<\/script>/gi, "")
    .replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, "")
    .trim();

/** The account chip is the one server-rendered block — React fills the slot. */
const swapAccount = (html, sourceName) => {
  const replaced = html.replace(/<div class="account">[\s\S]*?<\/div>/, "{{ACCOUNT}}");
  if (!replaced.includes("{{ACCOUNT}}")) {
    throw new Error(`Could not find the .account block in ${sourceName}`);
  }
  return replaced;
};

/* ------------------------------------------------------------------ portal */

const portalPhp = stripPhp(fs.readFileSync(path.join(phpRoot, "portal.php"), "utf8"));

const portalBody = stripScripts(
  swapAccount(bodyOf(portalPhp), "portal.php").replace(/href="index\.php"/g, 'href="/test"'),
);

const portalHtml = ['<link rel="stylesheet" href="/assets/portal.css?v=7" />', portalBody].join("\n");

/* -------------------------------------------------------------- test page */

const testPhp = stripPhp(fs.readFileSync(path.join(phpRoot, "index.php"), "utf8"));

const testBody = stripScripts(swapAccount(bodyOf(testPhp), "index.php"));

const testHtml = [headStyles(testPhp), testBody].filter(Boolean).join("\n");

/* ------------------------------------------------------------------ write */

fs.writeFileSync(path.join(outDir, "portal.html"), portalHtml, "utf8");
fs.writeFileSync(path.join(outDir, "test.html"), testHtml, "utf8");

for (const [name, html] of [
  ["portal.html", portalHtml],
  ["test.html", testHtml],
]) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const ok = html.includes("{{ACCOUNT}}");
  console.log(`${name}: ${html.length} bytes, ${ids.size} ids, placeholder ${ok ? "ok" : "MISSING"}`);
}
