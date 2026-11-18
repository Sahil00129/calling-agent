/**
 * Widget / SDK test harness — the old index.php, kept for debugging an agent:
 * embed widget, public-agent call, private-agent token flow and an event log.
 */

import LegacyPage from "@/components/LegacyPage";
import { testAccount } from "@/components/account";
import { testHtml } from "@/components/markup/test";
import { requireUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function TestPage() {
  const user = await requireUser("/test");
  const html = testHtml.replace("{{ACCOUNT}}", testAccount(user));

  return <LegacyPage html={html} script="/assets/app.js?v=2" watchdog />;
}
