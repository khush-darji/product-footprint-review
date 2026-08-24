"use client";

import type { ReactNode } from "react";
import { useSession } from "@/lib/session";
import { AccountPanel } from "@/components/AccountPanel";
import { LoginScreen } from "@/components/LoginScreen";

/**
 * Chooses between the two states the app has: signed out is a centred login screen with
 * no chrome at all; signed in is the sidebar plus content.
 *
 * The sidebar is not rendered while signed out — an empty nav around a login form
 * suggests there is something behind it to navigate to, and there is not.
 *
 * This is presentation only. Every API call is authenticated server-side and 401s
 * without a session, so a signed-out user who forced the queue to render would see
 * nothing but errors. The shell exists so they see something sensible instead.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-slate-50"
        role="status"
        aria-live="polite"
      >
        <span className="text-sm text-slate-500">Loading…</span>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Lets a keyboard user jump past the sidebar. Visible only while focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      {/*
        A landmark, so a screen-reader user can jump straight to it. On narrow screens it
        stacks above the content rather than hiding behind a toggle: it is small, and it
        is where sign-out lives.
      */}
      <aside
        aria-label="Account"
        className="w-full shrink-0 border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r"
      >
        <AccountPanel />
      </aside>

      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
