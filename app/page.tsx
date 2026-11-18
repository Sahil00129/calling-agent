/**
 * The portal: quick call, spreadsheet campaigns, calls & recordings, settings.
 *
 * Markup comes from components/markup/portal.html (extracted from the PHP build),
 * behaviour from public/assets/portal.js, data from the /api routes. Only the
 * account chip and the auth gate are React's business.
 */

import fs from "node:fs";
import path from "node:path";

import LegacyPage from "@/components/LegacyPage";
import { portalAccount } from "@/components/account";
import { requireUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

function portalMarkup(user: string): string {
  const file = path.join(process.cwd(), "components", "markup", "portal.html");
  return fs.readFileSync(file, "utf8").replace("{{ACCOUNT}}", portalAccount(user));
}

export default async function PortalPage() {
  const user = await requireUser("/");
  return <LegacyPage html={portalMarkup(user)} script="/assets/portal.js?v=7" />;
}
