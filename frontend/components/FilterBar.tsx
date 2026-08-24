"use client";

import {
  FootprintStats,
  QueueScope,
  ReviewStatus,
  SortKey,
  SortOrder,
} from "@/lib/types";

interface Props {
  status: ReviewStatus | "all";
  query: string;
  scope: QueueScope;
  highRiskOnly: boolean;
  sort: SortKey;
  order: SortOrder;
  stats: FootprintStats | null;
  onStatusChange: (status: ReviewStatus | "all") => void;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: QueueScope) => void;
  onHighRiskOnlyChange: (value: boolean) => void;
  onSortChange: (sort: SortKey, order: SortOrder) => void;
}

const STATUS_FILTERS: {
  value: ReviewStatus | "all";
  label: string;
  statKey: keyof FootprintStats;
}[] = [
  { value: "all", label: "All", statKey: "total" },
  { value: "pending", label: "Pending", statKey: "pending" },
  { value: "approved", label: "Approved", statKey: "approved" },
  { value: "rejected", label: "Rejected", statKey: "rejected" },
];

const SCOPES: { value: QueueScope; label: string }[] = [
  { value: "all", label: "Everything I can see" },
  { value: "owned", label: "Submissions I own" },
  { value: "shared", label: "Shared with me" },
];

const SORTS: { value: `${SortKey}:${SortOrder}`; label: string }[] = [
  { value: "submittedAt:desc", label: "Newest first" },
  { value: "submittedAt:asc", label: "Oldest first" },
  { value: "emissionsValue:desc", label: "Highest emissions" },
  { value: "emissionsValue:asc", label: "Lowest emissions" },
  { value: "uncertaintyPercent:desc", label: "Most uncertain" },
  { value: "uncertaintyPercent:asc", label: "Least uncertain" },
];

export function FilterBar({
  status,
  query,
  scope,
  highRiskOnly,
  sort,
  order,
  stats,
  onStatusChange,
  onQueryChange,
  onScopeChange,
  onHighRiskOnlyChange,
  onSortChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/*
          A group of toggle buttons with aria-pressed rather than role="tablist".
          These filter one list; they do not switch between tab panels, and claiming
          tab semantics would promise arrow-key navigation between panels that does not
          exist. aria-pressed describes what actually happens.
        */}
        <div
          className="flex gap-1 rounded-lg bg-slate-100 p-1"
          role="group"
          aria-label="Filter by review status"
        >
          {STATUS_FILTERS.map((filter) => {
            const selected = status === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onStatusChange(filter.value)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  selected
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {filter.label}
                {/* slate-500, not -400: at 12px slate-400 is 2.56:1 on white and fails
                    AA. axe misses this one because of the nested sr-only span, so it is
                    worth stating rather than trusting the audit. */}
                {stats && (
                  <span className="ml-1.5 text-xs text-slate-500">
                    {stats[filter.statKey]}
                    <span className="sr-only"> submissions</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div>
          <label htmlFor="search" className="sr-only">
            Search by product or supplier
          </label>
          <input
            id="search"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search product or supplier..."
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm transition-colors duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 sm:w-64"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="scope" className="text-sm text-slate-600">
            Show
          </label>
          <select
            id="scope"
            value={scope}
            onChange={(event) => onScopeChange(event.target.value as QueueScope)}
            className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm transition-colors duration-150 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          >
            {SCOPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-sm text-slate-600">
            Sort by
          </label>
          <select
            id="sort"
            value={`${sort}:${order}`}
            onChange={(event) => {
              const [nextSort, nextOrder] = event.target.value.split(":");
              onSortChange(nextSort as SortKey, nextOrder as SortOrder);
            }}
            className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm transition-colors duration-150 hover:border-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={highRiskOnly}
            onChange={(event) => onHighRiskOnlyChange(event.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-700 focus:ring-2 focus:ring-blue-600"
          />
          Hotspots only
          {stats && <span className="text-xs text-slate-500">{stats.highRisk}</span>}
        </label>
      </div>
    </div>
  );
}
