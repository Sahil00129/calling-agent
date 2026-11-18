/**
 * Widget / SDK test harness — the old index.php, kept for debugging an agent:
 * embed widget, public-agent call, private-agent token flow and an event log.
 */

import fs from "node:fs";
import path from "node:path";

import LegacyPage from "@/components/LegacyPage";
import { testAccount } from "@/components/account";
import { requireUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

function testMarkup(user: string): string {
  const file = path.join(process.cwd(), "components", "markup", "test.html");
  return fs.readFileSync(file, "utf8").replace("{{ACCOUNT}}", testAccount(user));
}

export default async function TestPage() {
  const user = await requireUser("/test");
  return <LegacyPage html={testMarkup(user)} script="/assets/app.js?v=2" watchdog />;
}
