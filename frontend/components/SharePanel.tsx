"use client";

import { useEffect, useState } from "react";
import { ApiError, grantShare, listShares, revokeShare } from "@/lib/api-client";
import type { Share, ShareableRole } from "@/lib/types";

/**
 * Manage who else can see a submission.
 *
 * Rendered only when the API says `capabilities.canShare`, but that is presentation, not
 * protection — every call below is authorised again server-side, and a non-owner who
 * forced this panel open would get a 403 from each one.
 */
export function SharePanel({ footprintId }: { footprintId: string }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareableRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const result = await listShares(footprintId, controller.signal);
        setShares(result.items);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as ApiError).userMessage);
      }
    }

    void load();
    return () => controller.abort();
  }, [footprintId, reloadToken]);

  async function handleGrant(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      const share = await grantShare(footprintId, email.trim(), role);
      setNotice(`${share.user.displayName} can now ${share.role === "editor" ? "review" : "view"} this submission.`);
      setEmail("");
      setReloadToken((n) => n + 1);
    } catch (err) {
      // The API explains exactly what was wrong (unknown address, malformed email,
      // sharing with yourself); surfacing its message beats inventing a generic one.
      setError((err as ApiError).userMessage);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(share: Share) {
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      await revokeShare(footprintId, share.user.id);
      setNotice(`${share.user.displayName} no longer has access.`);
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError((err as ApiError).userMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sharing-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="sharing-heading" className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Sharing
      </h3>

      <form onSubmit={(event) => void handleGrant(event)} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="share-email" className="block text-sm text-slate-600">
            Share with
          </label>
          <input
            id="share-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="colleague@example.com"
            aria-describedby={error ? "share-error" : undefined}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors duration-150 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>

        <div>
          <label htmlFor="share-role" className="block text-sm text-slate-600">
            Access
          </label>
          <select
            id="share-role"
            value={role}
            onChange={(event) => setRole(event.target.value as ShareableRole)}
            className="mt-1 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors duration-150 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          >
            <option value="viewer">Viewer — can read only</option>
            <option value="editor">Editor — can approve or reject</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-[42px] cursor-pointer items-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Working..." : "Share"}
        </button>
      </form>

      {error && (
        <p id="share-error" role="alert" className="mt-2 text-sm text-rose-600">
          {error}
        </p>
      )}
      {notice && (
        <p aria-live="polite" className="mt-2 text-sm text-emerald-700">
          {notice}
        </p>
      )}

      <div className="mt-5">
        {shares === null && <p className="text-sm text-slate-500">Loading sharing…</p>}

        {shares?.length === 0 && (
          <p className="text-sm text-slate-500">
            Not shared with anyone yet. Only you can see this submission.
          </p>
        )}

        {shares && shares.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {shares.map((share) => (
              <li key={share.user.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{share.user.displayName}</p>
                  <p className="text-xs text-slate-500">
                    {share.user.email} · {share.role === "editor" ? "can approve or reject" : "can view only"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(share)}
                  disabled={busy}
                  className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Revoke
                  <span className="sr-only"> access for {share.user.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
