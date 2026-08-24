"use client";

import { useState } from "react";
import { useSession } from "@/lib/session";
import { LeafIcon, SignOutIcon } from "@/components/icons";

/**
 * The left sidebar, shown only while signed in: product mark, who you are, and sign out.
 *
 * There is no user switcher. Identity comes from the session the server issued, so the
 * only way to become someone else is to sign out and present different credentials.
 * Demo credentials are not listed anywhere in the UI — they live in the README.
 */
export function AccountPanel() {
  const { user, logout } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
          <LeafIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-slate-900">
            Footprint Review
          </p>
          <p className="truncate text-xs text-slate-500">Supplier emissions</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-between p-5">
        <div>
          {/* slate-500, not slate-400: at 12px on white slate-400 is 2.56:1 and fails AA. */}
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Signed in
          </h2>

          <div className="mt-3 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-semibold text-white"
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {user.displayName}
              </p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
          </div>

          <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500">
            You see submissions you own and any shared with you. Everything else is not
            merely hidden here — it is never sent to your browser.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="mt-6 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <SignOutIcon />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
