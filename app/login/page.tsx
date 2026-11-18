/**
 * Sign-in screen. Public route (middleware lets it through); a signed-in visitor
 * is sent straight on to wherever they were going.
 */

import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth-server";

import LoginForm from "./LoginForm";
import "./login.css";

export const dynamic = "force-dynamic";

/** Only relative, same-site targets — an ?next=https://evil link must not work. */
function safeNext(value?: string): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; signed_out?: string };
}) {
  const next = safeNext(searchParams.next);
  const user = await currentUser();

  if (user) redirect(next);

  return (
    <div className="login-screen">
      <div className="login-shell">
        <div className="login-brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 13.5a7.5 7.5 0 0 1 15 0" />
              <rect x="9" y="13" width="6" height="5" rx="2" />
              <path d="M19.5 13.5v2a2.5 2.5 0 0 1-2.5 2.5h-1" />
            </svg>
          </span>
          <span className="login-brand-text">
            <strong>Voice portal</strong>
            <span>ElevenLabs agents</span>
          </span>
        </div>

        <div className="login-card">
          <h1>Sign in</h1>
          <p className="sub">This portal is restricted. Use the shared account to continue.</p>

          <LoginForm next={next} signedOut={Boolean(searchParams.signed_out)} />
        </div>
      </div>
    </div>
  );
}
