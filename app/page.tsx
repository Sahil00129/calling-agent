/**
 * The portal: quick call, spreadsheet campaigns, calls & recordings, settings.
 *
 * Markup comes from components/markup/portal.ts (extracted from the PHP build and
 * bundled, so it works on serverless hosts), behaviour from public/assets/portal.js,
 * data from the /api routes. Only the account chip and the auth gate are React's business.
 */

import LegacyPage from "@/components/LegacyPage";
import { portalAccount } from "@/components/account";
import { portalHtml } from "@/components/markup/portal";
import { requireUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const user = await requireUser("/");
  const html = portalHtml.replace("{{ACCOUNT}}", portalAccount(user));

  return <LegacyPage html={html} script="/assets/portal.js?v=7" />;
}
