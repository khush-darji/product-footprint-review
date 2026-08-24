// Browse and filter the review queue.
//
// Client component because it owns interactive filter state. Filtering, searching,
// sorting and paging all happen server-side via query params on GET /api/v1/footprints —
// the browser never receives rows it is not showing, and never receives rows the signed
// in user has no access to.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, getStats, listFootprints } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import type {
  FootprintStats,
  ProductFootprint,
  QueueScope,
  ReviewStatus,
  SortKey,
  SortOrder,
} from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { RiskFlag } from "@/components/RiskFlag";
import { RoleBadge } from "@/components/RoleBadge";
import { FilterBar } from "@/components/FilterBar";
import { LoadingState, EmptyState, ErrorState } from "@/components/RequestStates";

const PAGE_SIZE = 25;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: ProductFootprint[]; total: number; nextCursor: string | null };

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
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState({ kind: "error", message: (err as ApiError).userMessage });
      }
    }

    void load();
    return () => controller.abort();
  }, [user, status, debouncedQuery, scope, highRiskOnly, sort, order, reloadToken]);

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
  }, [state, status, debouncedQuery, scope, highRiskOnly, sort, order, loadingMore]);

  const handleSortChange = useCallback((nextSort: SortKey, nextOrder: SortOrder) => {
    // Changing the sort invalidates any cursor we hold — the API rejects a cursor issued
    // for a different ordering — so this always restarts from the first page.
    setSort(nextSort);
    setOrder(nextOrder);
  }, []);

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

      {state.kind === "loading" && <LoadingState label="Loading submissions..." />}

      {state.kind === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
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
                Supplier emissions submissions you can access, {state.items.length} of{" "}
                {state.total} shown.
              </caption>
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  {/*
                    Explicit widths with `table-fixed`: left to itself the browser gave
                    the product column the least room and wrapped names over four lines,
                    while "Uncertainty" kept a full column for "±9%". scope="col" ties
                    each cell to its header for screen readers.
                  */}
                  <th scope="col" className="w-[22rem] px-4 py-3">Product</th>
                  <th scope="col" className="w-[11rem] px-4 py-3">Supplier</th>
                  <th scope="col" className="w-[6rem] px-4 py-3">Access</th>
                  <th scope="col" className="w-[7rem] px-4 py-3">Status</th>
                  <th scope="col" className="w-[8rem] px-4 py-3">Emissions</th>
                  <th scope="col" className="w-[7rem] px-4 py-3">Uncertainty</th>
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
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-slate-900">{fp.product}</span>
                        <RiskFlag footprint={fp} />
                      </div>
                      <div className="text-xs text-slate-500">{fp.category}</div>
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
