"use client";

import { useState } from "react";
import { useSession } from "@/lib/session";
import { LeafIcon } from "@/components/icons";

/**
 * The signed-out screen: a single centred card, no sidebar, no navigation.
 *
 * Nothing else is on screen because nothing else is reachable — showing a disabled
 * queue behind a login form implies the data is there and merely hidden, which is the
 * opposite of what is true. The server sends no rows at all without a session.
 *
 * Credentials are deliberately NOT listed here. They live in the README, so a demo
 * account list is not sitting on a page that could be deployed somewhere real.
 */
export function LoginScreen() {
  const { signingIn, error, login } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });

  // Validate on blur rather than only on submit, so a typo is caught before the round
  // trip — but never before the field has been visited.
  const emailInvalid = touched.email && email.trim().length > 0 && !email.includes("@");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const ok = await login(email.trim(), password);
    // Never leave a password in component state after use.
    setPassword("");
    if (ok) setEmail("");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
            <LeafIcon className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
            Product Footprint Review
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to review supplier emissions submissions.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                required
                // Lets a password manager fill both fields as one credential.
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                aria-invalid={emailInvalid || Boolean(error) || undefined}
                aria-describedby={
                  emailInvalid ? "email-hint" : error ? "login-error" : undefined
                }
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 aria-[invalid=true]:border-rose-400"
              />
              {emailInvalid && (
                <p id="email-hint" className="mt-1.5 text-xs text-rose-600">
                  That does not look like an email address.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "login-error" : undefined}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors duration-150 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 aria-[invalid=true]:border-rose-400"
              />
            </div>

            {/* role="alert" so the failure is announced, not just coloured. */}
            {error && (
              <p
                id="login-error"
                role="alert"
                className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={signingIn}
              className="mt-1 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Demo account credentials are in the project README.
        </p>
      </div>
    </div>
  );
}
