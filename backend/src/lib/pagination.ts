/**
 * Keyset ("cursor") pagination.
 *
 * Offset pagination was the alternative and is wrong here for the usual reason: rows
 * shift between pages as submissions arrive and get reviewed, so a reviewer paging
 * through the queue would see one submission twice and miss another. A keyset cursor
 * points at a row, so the page after it is stable no matter what changed above.
 *
 * The cursor carries the sort key it was issued for. Changing the sort while holding a
 * cursor from a different ordering would silently return nonsense — instead it is
 * rejected, and the client starts the new ordering from the first page.
 *
 * A cursor is opaque to clients but it is still user input: `decodeCursor` trusts
 * nothing it decodes.
 */
import { ValidationError } from "./errors";

export type SortDirection = "asc" | "desc";

export interface Cursor {
  /** The sort field this cursor was issued for. */
  sortKey: string;
  /** The sort column's value on the last row of the previous page, as a string. */
  sortValue: string;
  /** That row's id, breaking ties between equal sort values. */
  id: string;
}

const SEPARATOR = "|";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  const raw = [cursor.sortKey, cursor.sortValue, cursor.id].join(SEPARATOR);
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * @param expectedSortKey the sort the current request is using; a cursor issued for a
 * different sort is rejected rather than silently misapplied.
 */
export function decodeCursor(raw: string, expectedSortKey: string): Cursor {
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const parts = decoded.split(SEPARATOR);

  if (parts.length !== 3) throw new ValidationError("Malformed pagination cursor");
  const [sortKey, sortValue, id] = parts as [string, string, string];

  if (!UUID_PATTERN.test(id)) throw new ValidationError("Malformed pagination cursor");
  if (sortValue.length === 0) throw new ValidationError("Malformed pagination cursor");

  if (sortKey !== expectedSortKey) {
    throw new ValidationError(
      `Cursor was issued for sort "${sortKey}" but the request sorts by "${expectedSortKey}". Start from the first page.`,
    );
  }

  return { sortKey, sortValue, id };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Turns an over-fetched row set (limit + 1) into a page. Fetching one extra row is how
 * we learn whether a next page exists without paying for a second query.
 */
export function toPage<T>(rows: T[], limit: number, makeCursor: (row: T) => Cursor): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(makeCursor(last)) : null,
  };
}
