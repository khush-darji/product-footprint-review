import { ReviewEvent } from "@/lib/types";

/**
 * The submission's decision history, from GET /api/v1/footprints/:id/reviews.
 *
 * `review_events` is append-only, so this shows every decision ever recorded rather than
 * only the latest one denormalised onto the submission row. Each entry carries the
 * status the submission moved into, the reviewer's comment, and when it happened.
 *
 * An entry matching `optimisticId` has been applied locally but not yet confirmed by the
 * server; it is dimmed and labelled rather than shown as settled fact.
 */
export function ReviewTimeline({
  events,
  optimisticId,
}: {
  events: ReviewEvent[];
  optimisticId?: string;
}) {
  if (events.length === 0) return null;

  return (
    <section
      aria-labelledby="review-history-heading"
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h3
        id="review-history-heading"
        className="text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        Review history
      </h3>

      <ol className="mt-4 flex flex-col gap-4">
        {events.map((event) => {
          const provisional = event.id === optimisticId;

          return (
            <li key={event.id} className={`flex gap-3 ${provisional ? "opacity-60" : ""}`}>
              {/* Decorative: the status is already stated in the text below, so the dot
                  carries no information a screen reader needs. */}
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  event.status === "approved" ? "bg-emerald-500" : "bg-rose-500"
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm text-slate-900">
                  <span className="font-medium">
                    {event.status === "approved" ? "Approved" : "Rejected"}
                  </span>{" "}
                  by {event.reviewedBy}
                  {provisional && <span className="text-slate-500"> · saving…</span>}
                </p>
                <p className="text-xs text-slate-500">
                  <time dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                </p>
                {event.comment && (
                  <p className="mt-1 text-sm text-slate-600">&ldquo;{event.comment}&rdquo;</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
