// Browse and filter the review queue.
//
// Client component because it owns interactive filter state. Filtering, searching,
// sorting and paging all happen server-side via query params on GET /api/v1/footprints —
// the browser never receives rows it is not showing, and never receives rows the signed
// in user has no access to.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  bulkReviewFootprints,
  getStats,
  listFootprints,
} from "@/lib/api-client";
import { useSession } from "@/lib/session";
import type {
  FootprintStats,
  ProductFootprint,
  QueueScope,
  ReviewDecision,
  ReviewStatus,
  SortKey,
  SortOrder,
} from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { RiskFlag } from "@/components/RiskFlag";
import { RoleBadge } from "@/components/RoleBadge";
import { FilterBar } from "@/components/FilterBar";
import {
  LoadingState,
  EmptyState,
  ErrorState,
} from "@/components/RequestStates";
import { CheckIcon, InfoIcon } from "@/components/icons";

const PAGE_SIZE = 25;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      items: ProductFootprint[];
      total: number;
      nextCursor: string | null;
    };

/** What one bulk decision did, kept for the summary shown afterwards. */
type BulkOutcome = {
  decision: ReviewDecision;
  succeeded: number;
  /** Product name and reason for each submission that could not be decided. */
  failed: { label: string; message: string }[];
};

/**
 * Which rows a bulk decision may include.
 *
 * Both halves matter: an already-decided submission would come back as a conflict, and
 * one shared with this user as a viewer would come back as a 403. Neither is enforced
 * here — the server checks both again — but offering a checkbox the server will refuse
 * is a worse experience than not offering it.
 */
function isBulkReviewable(fp: ProductFootprint): boolean {
  return fp.status === "pending" && fp.capabilities.canReview;
}

/** Why this particular row has no checkbox. Shown in the tooltip beside it. */
function selectionBlockedReason(fp: ProductFootprint): string {
  if (fp.status === "approved") {
    return "Already approved, so it cannot be part of a bulk decision.";
  }
  if (fp.status === "rejected") {
    return "Already rejected, so it cannot be part of a bulk decision.";
  }
  // Still pending, but shared with this user as a viewer.
  return "Shared with you as a viewer, so you cannot approve or reject it.";
}

/**
 * What stands in for the checkbox on a row a bulk decision cannot include.
 *
 * The cell is never left empty. While the column is on screen, a blank cell reads as a
 * checkbox that failed to render rather than as "this one is already dealt with", and a
 * page of mostly-decided rows turns into a ragged gutter of white.
 *
 * One icon for all three reasons rather than a tick, a cross and a dash: the mark itself
 * only has to say "not selectable, and there is a reason" — the reason is the tooltip's
 * job, and three glyphs would invite the reader to decode them against the Status column
 * that already spells it out.
 */
function SelectionPlaceholder({ footprint }: { footprint: ProductFootprint }) {
  const tooltipId = `no-select-${footprint.id}`;

  return (
    // `group` drives the tooltip from hover anywhere on this wrapper, and
    // `focus-within` is what makes the same thing reachable from the keyboard.
    <span className="group relative inline-flex">
      {/*
        A real button, not a bare icon with a `title`: `title` never appears on keyboard
        focus, waits about a second on hover, and cannot be styled. A button is focusable
        by default and `aria-describedby` hands the reason to a screen reader.
      */}
      <button
        type="button"
        aria-label="Why this cannot be selected"
        aria-describedby={tooltipId}
        className="inline-flex cursor-help rounded-full text-slate-400 transition-colors duration-150 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <InfoIcon className="h-4 w-4" />
      </button>

      {/*
        Opens to the right and stays vertically centred on the icon, so it fits inside a
        row's own height. That matters: the table sits in an `overflow-x-auto` box, which
        computes `overflow-y` to `auto` as well, and a tooltip taller than its row would
        be clipped by that box rather than floating over the page.
      */}
      <span
        role="tooltip"
        id={tooltipId}
        className="pointer-events-none absolute left-6 top-1/2 z-10 w-max max-w-[15rem] -translate-y-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs font-normal normal-case tracking-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {selectionBlockedReason(footprint)}
      </span>
    </span>
  );
}

export default function HomePage() {
  const { user } = useSession();

  const [status, setStatus] = useState<ReviewStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [scope, setScope] = useState<QueueScope>("all");
  const [highRiskOnly, setHighRiskOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("submittedAt");
  const [order, setOrder] = useState<SortOrder>("desc");

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [stats, setStats] = useState<FootprintStats | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Bulk review. The selection is a set of ids rather than a flag on each row, so it
  // survives the list being replaced by a filter change or extended by "Load more".
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkComment, setBulkComment] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState<ReviewDecision | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkOutcome | null>(null);

  // Light debounce so a request isn't fired on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    // Nothing to fetch until we know who we are — the token drives every request.
    if (!user) return;
    const controller = new AbortController();

    async function load() {
      try {
        // Independent requests, so they go out together rather than one after the other.
        const [page, nextStats] = await Promise.all([
          listFootprints({
            status,
            q: debouncedQuery || undefined,
            scope,
            highRiskOnly,
            sort,
            order,
            limit: PAGE_SIZE,
            signal: controller.signal,
          }),
          getStats(controller.signal),
        ]);

        setState({
          kind: "ready",
          items: page.items,
          total: page.total,
          nextCursor: page.pageInfo.nextCursor,
        });
        setStats(nextStats);
        // These are a different set of rows, so a selection made against the previous
        // list would silently decide submissions that are no longer on screen. (Note
        // this is not in `loadMore`: that appends to the list rather than replacing it,
        // and a selection made before paging is still a selection of visible rows.)
        setSelectedIds(new Set());
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState({ kind: "error", message: (err as ApiError).userMessage });
      }
    }

    void load();
    return () => controller.abort();
  }, [
    user,
    status,
    debouncedQuery,
    scope,
    highRiskOnly,
    sort,
    order,
    reloadToken,
  ]);

  const loadMore = useCallback(async () => {
    if (state.kind !== "ready" || !state.nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await listFootprints({
        status,
        q: debouncedQuery || undefined,
        scope,
        highRiskOnly,
        sort,
        order,
        limit: PAGE_SIZE,
        cursor: state.nextCursor,
      });
      setState({
        kind: "ready",
        items: [...state.items, ...page.items],
        total: page.total,
        nextCursor: page.pageInfo.nextCursor,
      });
    } catch (err) {
      setState({ kind: "error", message: (err as ApiError).userMessage });
    } finally {
      setLoadingMore(false);
    }
  }, [
    state,
    status,
    debouncedQuery,
    scope,
    highRiskOnly,
    sort,
    order,
    loadingMore,
  ]);

  const handleSortChange = useCallback(
    (nextSort: SortKey, nextOrder: SortOrder) => {
      // Changing the sort invalidates any cursor we hold — the API rejects a cursor issued
      // for a different ordering — so this always restarts from the first page.
      setSort(nextSort);
      setOrder(nextOrder);
    },
    [],
  );

  /** Rows currently on screen that a bulk decision could apply to. */
  const reviewableIds = useMemo(
    () =>
      state.kind === "ready"
        ? state.items.filter(isBulkReviewable).map((fp) => fp.id)
        : [],
    [state],
  );

  /**
   * Whether bulk review has any bearing on the queue as it is currently filtered.
   *
   * The Approved and Rejected tabs are lists of decisions already taken, so nothing they
   * can ever contain is selectable. Deciding that from the *filter* rather than from the
   * rows means the column and the note are gone the moment the tab is clicked, instead
   * of after the response lands and the row check finds nothing — no flash of a column
   * that is about to disappear.
   */
  const bulkReviewApplies = status !== "approved" && status !== "rejected";

  /**
   * The selection column is only rendered when something on screen could use it.
   *
   * Once every row is decided, keeping it would leave a 3rem gutter of white down the
   * left of the table under a header checkbox that can never be ticked. Dropping the
   * column instead lets the remaining columns reclaim the width, and it goes together
   * with the hint above the table, which is gated on the same condition.
   */
  const showSelectionColumn = bulkReviewApplies && reviewableIds.length > 0;

  const allReviewableSelected =
    reviewableIds.length > 0 && reviewableIds.every((id) => selectedIds.has(id));

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      // `delete` reports whether it removed anything, which is the same question as
      // "was this row selected".
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((current) => {
      const everySelected =
        reviewableIds.length > 0 && reviewableIds.every((id) => current.has(id));
      return everySelected ? new Set<string>() : new Set(reviewableIds);
    });
  }, [reviewableIds]);

  const submitBulkReview = useCallback(
    async (decision: ReviewDecision) => {
      const ids = [...selectedIds];
      if (state.kind !== "ready" || ids.length === 0 || bulkSubmitting) return;

      // Captured before the call: a failure has to be reported by product name, and the
      // row it refers to may be gone from the list by the time we render the message.
      const nameById = new Map(state.items.map((fp) => [fp.id, fp.product]));

      setBulkSubmitting(decision);
      setBulkError(null);
      setBulkOutcome(null);

      try {
        const result = await bulkReviewFootprints(ids, decision, bulkComment);

        setBulkOutcome({
          decision,
          succeeded: result.succeeded.length,
          failed: result.failed.map((failure) => ({
            label: nameById.get(failure.id) ?? failure.id,
            message: failure.message,
          })),
        });
        setBulkComment("");
        setSelectedIds(new Set());

        if (result.failed.length > 0) {
          // A failure usually means somebody else moved the row first, so what is on
          // screen is out of date in ways this response does not describe. Refetching is
          // cheaper than guessing which rows to correct.
          setReloadToken((n) => n + 1);
          return;
        }

        // Patch the decided rows in place rather than refetching, so pages already
        // loaded via "Load more" are not thrown away.
        const decided = new Map(result.succeeded.map((fp) => [fp.id, fp]));
        setState((current) => {
          if (current.kind !== "ready") return current;
          const items = current.items
            .map((fp) => decided.get(fp.id) ?? fp)
            // A row that no longer matches the active status filter would not have come
            // back from the server either, so it leaves rather than sitting there
            // contradicting the filter above it.
            .filter((fp) => status === "all" || fp.status === status);

          return {
            ...current,
            items,
            total: current.total - (current.items.length - items.length),
          };
        });

        // The header counts moved, and they are computed server-side.
        setStats(await getStats());
      } catch (err) {
        setBulkError((err as ApiError).userMessage);
      } finally {
        setBulkSubmitting(null);
      }
    },
    [selectedIds, state, bulkComment, bulkSubmitting, status],
  );

  const emptyMessage = useMemo(() => {
    if (debouncedQuery) return `No submissions match "${debouncedQuery}".`;
    if (highRiskOnly) return "No hotspots match this filter.";
    if (scope === "owned") return "You have not submitted anything yet.";
    if (scope === "shared") return "Nobody has shared a submission with you.";
    if (status !== "all") return `No ${status} submissions right now.`;
    return "No submissions yet.";
  }, [debouncedQuery, status, scope, highRiskOnly]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Review queue
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Supplier emissions submissions you own or have been given access to.
        </p>
      </div>

      <FilterBar
        status={status}
        query={query}
        scope={scope}
        highRiskOnly={highRiskOnly}
        sort={sort}
        order={order}
        stats={stats}
        onStatusChange={setStatus}
        onQueryChange={setQuery}
        onScopeChange={setScope}
        onHighRiskOnlyChange={setHighRiskOnly}
        onSortChange={handleSortChange}
      />

      {/*
        The outcome of the last bulk decision, kept until the next one. Partial success
        is the normal case worth designing for — a submission a colleague decided first
        is reported here rather than failing the whole batch — so both halves are shown.
      */}
      {bulkOutcome && (
        <div
          role="status"
          className={`rounded-xl border p-4 text-sm ${
            bulkOutcome.failed.length > 0
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <p className="font-medium">
              {bulkOutcome.decision === "approved" ? "Approved" : "Rejected"}{" "}
              {bulkOutcome.succeeded}{" "}
              {bulkOutcome.succeeded === 1 ? "submission" : "submissions"}
              {bulkOutcome.failed.length > 0 &&
                ` · ${bulkOutcome.failed.length} could not be decided`}
            </p>
            <button
              type="button"
              onClick={() => setBulkOutcome(null)}
              className="cursor-pointer text-xs font-medium underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Dismiss
            </button>
          </div>
          {bulkOutcome.failed.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {bulkOutcome.failed.map((failure) => (
                <li key={failure.label}>
                  <span className="font-medium">{failure.label}</span>:{" "}
                  {failure.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/*
        What the checkboxes are for. Without this the column reads as decoration until
        you happen to tick one, and the action bar that explains itself only appears
        after that — so the feature is invisible to anyone who has not already found it.

        It occupies the same slot as the action bar rather than sitting above it: once
        there is a selection the bar says everything this does, and stacking both would
        push the table down by two boxes.

        Gated on `showSelectionColumn`, the same flag the column itself uses, so the two
        cannot drift apart: there is no state in which this points at checkboxes that
        were not rendered, or in which a column appears with nothing to explain it.
      */}
      {state.kind === "ready" && showSelectionColumn && selectedIds.size === 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <CheckIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <span>
            To review several at once, tick the checkboxes beside the submissions you
            want, then approve or reject them together with a shared comment.{" "}
            {reviewableIds.length === 1
              ? "1 submission here is awaiting your decision."
              : `${reviewableIds.length} submissions here are awaiting your decision.`}
          </span>
        </p>
      )}

      {/*
        Only rendered once something is selected. A permanently visible action bar would
        take vertical space above every list, including the ones with nothing a bulk
        decision could apply to.
      */}
      {selectedIds.size > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-900" aria-live="polite">
              {selectedIds.size} selected
            </p>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="cursor-pointer text-xs font-medium text-slate-600 underline underline-offset-2 transition-colors duration-150 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Clear selection
            </button>
          </div>

          <label
            htmlFor="bulk-comment"
            className="mt-3 block text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            Comment (optional)
          </label>
          <textarea
            id="bulk-comment"
            value={bulkComment}
            onChange={(event) => setBulkComment(event.target.value)}
            rows={2}
            maxLength={2000}
            aria-describedby={bulkError ? "bulk-error" : "bulk-comment-hint"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors duration-150 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            placeholder="Add context for this decision..."
          />
          <p id="bulk-comment-hint" className="mt-1 text-xs text-slate-500">
            Recorded against every submission in this batch, in each one&apos;s
            review history.
          </p>

          {bulkError && (
            <p id="bulk-error" role="alert" className="mt-2 text-sm text-rose-600">
              {bulkError}
            </p>
          )}

          <div className="mt-3 flex gap-3">
            {/* Same colours as the single-submission page: the action is the same one. */}
            <button
              type="button"
              onClick={() => void submitBulkReview("approved")}
              disabled={bulkSubmitting !== null}
              className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bulkSubmitting === "approved"
                ? "Approving..."
                : `Approve ${selectedIds.size}`}
            </button>
            <button
              type="button"
              onClick={() => void submitBulkReview("rejected")}
              disabled={bulkSubmitting !== null}
              className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-rose-700 px-4 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bulkSubmitting === "rejected"
                ? "Rejecting..."
                : `Reject ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      {state.kind === "loading" && (
        <LoadingState label="Loading submissions..." />
      )}

      {state.kind === "error" && (
        <ErrorState
          message={state.message}
          onRetry={() => setReloadToken((n) => n + 1)}
        />
      )}

      {state.kind === "ready" && state.items.length === 0 && (
        <EmptyState title="No submissions found" message={emptyMessage} />
      )}

      {state.kind === "ready" && state.items.length > 0 && (
        <>
          {/*
            `relative` is load-bearing, not decoration. The table is wider than a phone
            screen and scrolls inside this box — but the `sr-only` caption and cell
            labels are `position: absolute`, and without a positioned ancestor their
            containing block is the viewport, so they escaped this container entirely
            and laid out at their natural width (`white-space: nowrap`). That dragged the
            whole *page* into horizontal scroll at 375px. Making this box the containing
            block keeps them inside it.
          */}
          <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            {/*
              A floor width rather than `min-w-full`: letting the table shrink to a phone
              screen squeezed the product column into four-line wraps. Below this width it
              scrolls inside the container above, which is far easier to read.
            */}
            <table className="w-full min-w-[56rem] table-fixed divide-y divide-slate-200 text-sm">
              <caption className="sr-only">
                Supplier emissions submissions you can access,{" "}
                {state.items.length} of {state.total} shown.
              </caption>
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  {/*
                    Explicit widths with `table-fixed`: left to itself the browser gave
                    the product column the least room and wrapped names over four lines,
                    while "Uncertainty" kept a full column for "±9%". scope="col" ties
                    each cell to its header for screen readers.
                  */}
                  {showSelectionColumn && (
                    <th scope="col" className="w-[3rem] px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allReviewableSelected}
                        // "Some but not all" is a third state a checked/unchecked
                        // attribute cannot express, so it is set on the node directly.
                        ref={(node) => {
                          if (node) {
                            node.indeterminate =
                              !allReviewableSelected &&
                              reviewableIds.some((id) => selectedIds.has(id));
                          }
                        }}
                        onChange={toggleSelectAll}
                        aria-label="Select all reviewable submissions on this page"
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-600"
                      />
                    </th>
                  )}
                  <th scope="col" className="w-[22rem] px-4 py-3">
                    Product
                  </th>
                  <th scope="col" className="w-[11rem] px-4 py-3">
                    Supplier
                  </th>
                  <th scope="col" className="w-[6rem] px-4 py-3">
                    Access
                  </th>
                  <th scope="col" className="w-[7rem] px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="w-[8rem] px-4 py-3">
                    Emissions
                  </th>
                  <th scope="col" className="w-[7rem] px-4 py-3">
                    Uncertainty
                  </th>
                  <th scope="col" className="w-[6rem] px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.items.map((fp) => (
                  <tr
                    key={fp.id}
                    className="transition-colors duration-150 hover:bg-slate-50"
                  >
                    {showSelectionColumn && (
                      <td className="px-4 py-3">
                        {/*
                          A marker rather than a disabled checkbox for a row nobody could
                          bulk-decide: a greyed-out checkbox on an approved submission
                          invites the reader to work out why it is unavailable, when the
                          Status column has already said.
                        */}
                        {isBulkReviewable(fp) ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(fp.id)}
                            onChange={() => toggleSelected(fp.id)}
                            aria-label={`Select ${fp.product} for bulk review`}
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-600"
                          />
                        ) : (
                          <SelectionPlaceholder footprint={fp} />
                        )}
                      </td>
                    )}
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-slate-900">
                          {fp.product}
                        </span>
                        <RiskFlag footprint={fp} />
                      </div>
                      <div className="text-xs text-slate-500">
                        {fp.category}
                      </div>
                    </th>
                    <td className="px-4 py-3 text-slate-700">{fp.supplier}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={fp.accessRole} owner={fp.owner} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={fp.status} />
                    </td>
                    {/* Tabular figures so the digits line up down the column. */}
                    <td className="tabular whitespace-nowrap px-4 py-3 text-slate-700">
                      {fp.emissionsValue} kg CO2e
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-slate-700">
                      ±{fp.uncertaintyPercent}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/footprint/${fp.id}`}
                        className="inline-flex cursor-pointer items-center rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                      >
                        {fp.capabilities.canReview ? "Review" : "View"}
                        <span className="sr-only"> {fp.product}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            {/* Announced so a screen-reader user knows the list grew after "Load more". */}
            <span aria-live="polite">
              Showing {state.items.length} of {state.total}
            </span>
            {state.nextCursor && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
