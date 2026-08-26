/**
 * Business rules for footprint review, including who may do what.
 *
 * Nothing here imports Express: every function takes plain arguments and returns plain
 * data, so the rules below are testable by calling them. The acting user arrives as an
 * argument supplied by `requireAuth`, never from a request body.
 *
 * The authorization pattern is the same everywhere: load the record *through* the
 * access-scoped query, treat "not returned" as 404, then check the role against the
 * capability the action needs and return 403 if it falls short. Checking the role in the
 * service rather than the route means every caller inherits it.
 */
import {
  canEdit,
  canManage,
  canReview,
  type AccessRole,
} from "../domain/access";
import type {
  BulkReviewFailureDto,
  BulkReviewResultDto,
  FootprintStatsDto,
  ProductFootprintDto,
  ReviewEventDto,
} from "../domain/footprint";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../lib/errors";
import { decodeCursor, toPage, type Page } from "../lib/pagination";
import { toFootprintDto, toReviewEventDto } from "../mappers/footprint.mapper";
import type { AuthenticatedUser } from "../middleware/auth";
import * as footprintRepo from "../repositories/footprint.repository";
import type {
  BulkReviewInput,
  CreateFootprintInput,
  ListFootprintsQuery,
  ListReviewsQuery,
  ReviewFootprintInput,
  UpdateFootprintInput,
} from "../schemas/footprint.schema";

export interface FootprintListResult extends Page<ProductFootprintDto> {
  /** Total rows matching the filters, across all pages. Drives the queue header. */
  total: number;
}

/**
 * Loads a submission the caller can see, or throws 404.
 *
 * "Not found" and "not shared with you" are deliberately indistinguishable: a 403 here
 * would confirm the submission exists, which is itself information the caller has not
 * been granted.
 */
async function loadAccessible(
  user: AuthenticatedUser,
  id: string,
): Promise<footprintRepo.AccessibleFootprint> {
  const accessible = await footprintRepo.findAccessibleById(user.id, id);
  if (!accessible) {
    throw new NotFoundError(`No submission found with id "${id}"`);
  }
  return accessible;
}

export async function listFootprints(
  user: AuthenticatedUser,
  query: ListFootprintsQuery,
): Promise<FootprintListResult> {
  const filters: footprintRepo.ListFilters = {
    status: query.status,
    search: query.q,
    category: query.category,
    supplier: query.supplier,
    highRiskOnly: query.highRiskOnly,
    scope: query.scope,
  };

  const cursor = query.cursor
    ? decodeCursor(query.cursor, query.sort)
    : undefined;

  // Independent queries, so they run concurrently rather than one after the other.
  const [rows, total] = await Promise.all([
    footprintRepo.findPage(
      user.id,
      filters,
      query.sort,
      query.order,
      query.limit,
      cursor,
    ),
    footprintRepo.countMatching(user.id, filters),
  ]);

  const page = toPage(rows, query.limit, (row) => ({
    sortKey: query.sort,
    sortValue:
      query.sort === "submittedAt"
        ? row.footprint.submittedAt.toISOString()
        : String(row.footprint[query.sort]),
    id: row.footprint.id,
  }));

  return {
    items: page.items.map((row) => toFootprintDto(row.footprint, row.role)),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    total,
  };
}

export async function getFootprint(
  user: AuthenticatedUser,
  id: string,
): Promise<ProductFootprintDto> {
  const { footprint, role } = await loadAccessible(user, id);
  return toFootprintDto(footprint, role);
}

/** Anyone may submit a footprint; they own what they create. */
export async function createFootprint(
  user: AuthenticatedUser,
  input: CreateFootprintInput,
): Promise<ProductFootprintDto> {
  const created = await footprintRepo.create({
    // Ownership comes from the authenticated session, never from the body — otherwise a
    // client could create submissions owned by somebody else.
    ownerId: user.id,
    product: input.product,
    supplier: input.supplier,
    category: input.category,
    emissionsValue: input.emissionsValue,
    uncertaintyPercent: input.uncertaintyPercent,
    supplierNotes: input.supplierNotes,
    submittedAt: input.submittedAt,
  });

  // Re-read through the access-scoped query rather than mapping the just-saved entity:
  // `save` returns the row without the `owner` relation loaded, so the response would
  // carry `owner: null` and the client could not tell who owns what it just created.
  const accessible = await footprintRepo.findAccessibleById(
    user.id,
    created.id,
  );
  if (!accessible) {
    // Unreachable — the creator always owns the row — but throwing beats returning a
    // half-populated DTO if that ever stops being true.
    throw new NotFoundError(`No submission found with id "${created.id}"`);
  }

  return toFootprintDto(accessible.footprint, accessible.role);
}

/**
 * Corrections are only allowed while a submission is still pending, and only by an owner
 * or editor. Editing the emissions figure under an approval would leave the record
 * saying a reviewer approved a number they never saw.
 */
export async function updateFootprint(
  user: AuthenticatedUser,
  id: string,
  input: UpdateFootprintInput,
): Promise<ProductFootprintDto> {
  const { footprint, role } = await loadAccessible(user, id);

  if (!canEdit(role)) {
    throw new ForbiddenError("Your access to this submission is view-only.");
  }

  if (footprint.status !== "pending") {
    throw new ConflictError(
      `Submission is already "${footprint.status}" and can no longer be edited.`,
    );
  }

  await footprintRepo.update(id, input);

  // Re-read through the access-scoped query so the response carries the joined owner,
  // the same as every other read. See createFootprint for why.
  const refreshed = await footprintRepo.findAccessibleById(user.id, id);
  if (!refreshed)
    throw new NotFoundError(`No submission found with id "${id}"`);
  return toFootprintDto(refreshed.footprint, refreshed.role);
}

/** Owner-only: deleting takes the submission away from everyone it was shared with. */
export async function deleteFootprint(
  user: AuthenticatedUser,
  id: string,
): Promise<void> {
  const { role } = await loadAccessible(user, id);

  if (!canManage(role)) {
    throw new ForbiddenError("Only the owner can delete a submission.");
  }

  const deleted = await footprintRepo.remove(id);
  if (!deleted) throw new NotFoundError(`No submission found with id "${id}"`);
}

/**
 * Approve or reject a submission.
 *
 * The role check happens here; the *pending* check happens inside the repository
 * transaction under a row lock, because checking here and writing there is exactly the
 * race that lets two reviewers both approve the same submission.
 */
export async function reviewFootprint(
  user: AuthenticatedUser,
  id: string,
  input: ReviewFootprintInput,
): Promise<ProductFootprintDto> {
  const { role } = await loadAccessible(user, id);

  if (!canReview(role)) {
    throw new ForbiddenError(
      "Your access to this submission is view-only, so you cannot approve or reject it.",
    );
  }

  const outcome = await footprintRepo.recordReview(
    user.id,
    id,
    input.decision,
    input.comment,
    user.displayName,
  );

  switch (outcome.kind) {
    case "not_found":
      throw new NotFoundError(`No submission found with id "${id}"`);
    case "already_reviewed":
      throw new ConflictError(
        `Submission is already "${outcome.status}" and cannot be reviewed again.`,
      );
    case "reviewed": {
      // Re-read for the joined owner, as with create and update.
      const refreshed = await footprintRepo.findAccessibleById(user.id, id);
      return refreshed
        ? toFootprintDto(refreshed.footprint, refreshed.role)
        : toFootprintDto(outcome.footprint, role);
    }
  }
}

/**
 * Approve or reject several submissions in one call, applying one comment to all of them.
 *
 * Two decisions shape this:
 *
 *  1. **Each submission is decided on its own, and one failure does not abandon the
 *     rest.** A reviewer who selects twenty rows should not lose nineteen sound
 *     decisions because a colleague approved the twentieth a second earlier, or because
 *     one of them is shared with them as a viewer. Every id is attempted and the caller
 *     is told, per id, what happened. There is deliberately no batch-wide transaction:
 *     rolling back good decisions to punish a stale one is the worse failure mode here.
 *  2. **Ids are decided in sorted order.** Two bulk requests over overlapping selections
 *     would otherwise take their row locks in whatever order each client listed them,
 *     and could deadlock holding what the other needs. A single agreed order means the
 *     second request simply waits.
 *
 * Authorization, the pending check and the timeline entry are not re-implemented here —
 * this delegates to `reviewFootprint` per id, so a bulk decision can never be permitted
 * where a single one would not be.
 */
export async function bulkReview(
  user: AuthenticatedUser,
  input: BulkReviewInput,
): Promise<BulkReviewResultDto> {
  const succeeded: ProductFootprintDto[] = [];
  const failed: BulkReviewFailureDto[] = [];

  for (const id of [...input.ids].sort()) {
    try {
      succeeded.push(
        await reviewFootprint(user, id, {
          decision: input.decision,
          comment: input.comment,
        }),
      );
    } catch (error) {
      // Only a client-side failure is a per-item result. A 5xx — the database being
      // unreachable, say — is not something the next id will survive either, so it
      // propagates and fails the request rather than being reported 100 times.
      if (error instanceof AppError && error.status < 500) {
        failed.push({ id, code: error.code, message: error.message });
        continue;
      }
      throw error;
    }
  }

  return { succeeded, failed };
}

/** Visible to anyone who can see the submission, including viewers. */
export async function listReviewEvents(
  user: AuthenticatedUser,
  id: string,
  query: ListReviewsQuery,
): Promise<ReviewEventDto[]> {
  // Establishes access first, so an unknown or unshared id is a 404 rather than an empty
  // list — which a client cannot tell apart from "not reviewed yet".
  await loadAccessible(user, id);

  const events = await footprintRepo.findReviewEvents(id, query.limit);
  return events.map(toReviewEventDto);
}

export async function getStats(
  user: AuthenticatedUser,
): Promise<FootprintStatsDto> {
  return footprintRepo.getStats(user.id);
}

/** Re-exported so the share service can reuse the same 404-on-no-access behaviour. */
export { loadAccessible };
export type { AccessRole };
