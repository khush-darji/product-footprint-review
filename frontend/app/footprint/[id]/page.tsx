// Inspect a submission, approve or reject it, and see the result.
//
// The confirmation step updates this page in place rather than redirecting: the reviewer
// sees exactly what they just decided, with a link back to the queue when they are ready
// to move on.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ApiError,
  getFootprint,
  listReviewEvents,
  reviewFootprint,
} from "@/lib/api-client";
import { useSession } from "@/lib/session";
import type { ProductFootprint, ReviewDecision, ReviewEvent } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { RiskFlag } from "@/components/RiskFlag";
import { RoleBadge } from "@/components/RoleBadge";
import { ReviewTimeline } from "@/components/ReviewTimeline";
import { SharePanel } from "@/components/SharePanel";
import { LoadingState, ErrorState } from "@/components/RequestStates";
import { ArrowLeftIcon } from "@/components/icons";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; footprint: ProductFootprint; events: ReviewEvent[] };

/** A timeline entry shown before the server has confirmed it. */
const OPTIMISTIC_ID = "optimistic-pending";

export default function FootprintDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useSession();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState<ReviewDecision | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // The fetch lives inside the effect rather than a `useCallback` above it, so the only
  // state written here happens after an await — never synchronously in the effect body,
  // which would cause a cascading render.
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    async function run() {
      try {
        const [footprint, reviews] = await Promise.all([
          getFootprint(id, controller.signal),
          listReviewEvents(id, controller.signal),
        ]);
        setState({ kind: "ready", footprint, events: reviews.items });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState({ kind: "error", message: (err as ApiError).userMessage });
      }
    }

    void run();
    return () => controller.abort();
  }, [id, user, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    reload();
  }, [reload]);

  /**
   * Optimistic approve/reject.
   *
   * The decision is applied to local state immediately — status badge, the disappearing
   * form, a provisional timeline entry — then reconciled with the server's response.
   * On failure the *entire* previous state is restored from the snapshot rather than
   * being patched back field by field, so a partial rollback cannot leave the page
   * showing a decision that never happened.
   *
   * The risky case this has to get right is a 409 (someone else decided first). There,
   * rolling back to "pending" would be wrong too — the submission genuinely is decided,
   * just not by us — so it refetches instead of restoring the snapshot.
   */
  async function submitReview(decision: ReviewDecision) {
    if (state.kind !== "ready" || !user) return;

    const snapshot = state;
    const trimmed = comment.trim();

    setActionError(null);
    setSubmitting(decision);

    setState({
      kind: "ready",
      footprint: {
        ...snapshot.footprint,
        status: decision,
        reviewComment: trimmed || null,
        reviewedBy: user.displayName,
        reviewedAt: new Date().toISOString(),
      },
      events: [
        {
          id: OPTIMISTIC_ID,
          footprintId: snapshot.footprint.id,
          decision,
          status: decision,
          comment: trimmed || null,
          reviewedBy: user.displayName,
          createdAt: new Date().toISOString(),
        },
        ...snapshot.events,
      ],
    });

    try {
      const updated = await reviewFootprint(id, decision, trimmed || undefined);
      const reviews = await listReviewEvents(id);
      // Replace the guess with what the server actually recorded.
      setState({ kind: "ready", footprint: updated, events: reviews.items });
      setComment("");
    } catch (err) {
      const apiError = err as ApiError;

      if (apiError.status === 409) {
        // Somebody reviewed it first. The optimistic state is wrong, but so is the
        // snapshot — refetch to show what actually happened.
        setActionError(apiError.userMessage);
        reload();
        return;
      }

      setState(snapshot);
      setActionError(apiError.userMessage);
    } finally {
      setSubmitting(null);
    }
  }

  if (state.kind === "loading") return <LoadingState label="Loading submission..." />;
  if (state.kind === "error") return <ErrorState message={state.message} onRetry={retry} />;

  const fp = state.footprint;
  const pendingOptimistic = state.events.some((event) => event.id === OPTIMISTIC_ID);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded text-sm text-slate-500 transition-colors duration-150 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to queue
      </Link>

      <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{fp.product}</h2>
            <p className="text-sm text-slate-500">
              {fp.supplier} · {fp.category}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RiskFlag footprint={fp} />
            <RoleBadge role={fp.accessRole} owner={fp.owner} />
            {/* Announced so the optimistic status change reaches a screen reader. */}
            <span aria-live="polite">
              <StatusBadge status={fp.status} />
            </span>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Emissions
            </dt>
            <dd className="tabular mt-1 text-sm font-medium text-slate-900">
              {fp.emissionsValue} kg CO2e
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Uncertainty
            </dt>
            <dd className="tabular mt-1 text-sm font-medium text-slate-900">
              ±{fp.uncertaintyPercent}%
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Submitted
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {new Date(fp.submittedAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Owner
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {fp.owner?.displayName ?? "Unknown"}
            </dd>
          </div>
        </dl>

        {fp.supplierNotes && (
          <div className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Supplier notes
            </h3>
            <p className="mt-1 text-sm text-slate-700">{fp.supplierNotes}</p>
          </div>
        )}

        {fp.status !== "pending" && (
          <div
            className={`mt-6 rounded-md border p-4 ${
              pendingOptimistic
                ? "border-slate-200 bg-slate-50 opacity-70"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <p className="text-sm font-medium text-slate-900">
              {fp.status === "approved" ? "Approved" : "Rejected"}
              {fp.reviewedBy ? ` by ${fp.reviewedBy}` : ""}
              {fp.reviewedAt ? ` on ${new Date(fp.reviewedAt).toLocaleString()}` : ""}
              {/* Honest about the state: the decision is shown but not yet confirmed. */}
              {pendingOptimistic && " · saving…"}
            </p>
            {fp.reviewComment && (
              <p className="mt-1 text-sm text-slate-600">&ldquo;{fp.reviewComment}&rdquo;</p>
            )}
          </div>
        )}

        {fp.status === "pending" && fp.capabilities.canReview && (
          <div className="mt-6 border-t border-slate-100 pt-6">
            <label
              htmlFor="comment"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Comment (optional)
            </label>
            <textarea
              id="comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              maxLength={2000}
              aria-describedby={actionError ? "review-error" : "comment-hint"}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors duration-150 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              placeholder="Add context for this decision..."
            />
            {/* slate-500, not slate-400: at 12px on white slate-400 is 2.56:1. */}
            <p id="comment-hint" className="mt-1 text-xs text-slate-500">
              Recorded against your decision in the review history.
            </p>

            {actionError && (
              <p id="review-error" role="alert" className="mt-2 text-sm text-rose-600">
                {actionError}
              </p>
            )}

            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => void submitReview("approved")}
                disabled={submitting !== null}
                /* emerald-700, not -600: white on emerald-600 is 3.76:1 and fails AA for 14px text. */
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting === "approved" ? "Approving..." : "Approve"}
              </button>
              <button
                type="button"
                onClick={() => void submitReview("rejected")}
                disabled={submitting !== null}
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-rose-700 px-4 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting === "rejected" ? "Rejecting..." : "Reject"}
              </button>
            </div>
          </div>
        )}

        {fp.status === "pending" && !fp.capabilities.canReview && (
          <p className="mt-6 border-t border-slate-100 pt-6 text-sm text-slate-500">
            This submission is shared with you as a viewer, so you can read it but not
            approve or reject it. Ask {fp.owner?.displayName ?? "the owner"} for editor
            access if you need to review it.
          </p>
        )}
      </article>

      <ReviewTimeline events={state.events} optimisticId={OPTIMISTIC_ID} />

      {fp.capabilities.canShare && <SharePanel footprintId={fp.id} />}
    </div>
  );
}
