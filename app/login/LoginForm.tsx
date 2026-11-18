"use client";

import { useState } from "react";

interface Props {
  next: string;
  signedOut: boolean;
}

export default function LoginForm({ next, signedOut }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Sign-in failed — please try again.");
        setBusy(false);
        return;
      }

      // Full navigation so the new cookie is active for the very first RSC request.
      window.location.replace(next);
    } catch {
      setError("Could not reach the server — is it running?");
      setBusy(false);
    }
  }

  return (
    <>
      {error ? (
        <div className="login-alert" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5" />
            <path d="M12 16.5h.01" />
          </svg>
          <span>{error}</span>
        </div>
      ) : signedOut ? (
        <div className="login-alert ok" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.5 2.5 4.5-5" />
          </svg>
          <span>You have been signed out.</span>
        </div>
      ) : null}

      <form onSubmit={submit} autoComplete="on" noValidate>
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <span className="input-wrap">
            <input
              type={reveal ? "text" : "password"}
              className="pw"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="reveal"
              aria-label={reveal ? "Hide password" : "Show password"}
              aria-pressed={reveal}
              onClick={() => setReveal((value) => !value)}
            >
              {reveal ? "Hide" : "Show"}
            </button>
          </span>
        </label>

        <button type="submit" className="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="login-foot">
        <span className="login-lock">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="10.5" width="15" height="9" rx="2" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
          </svg>
          Sessions end after 8 hours of inactivity.
        </span>
      </p>
    </>
  );
}
