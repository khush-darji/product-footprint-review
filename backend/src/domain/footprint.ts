/**
 * Framework-free domain vocabulary for product footprint review.
 *
 * Nothing in here imports Express or TypeORM, so the rules below are testable by
 * calling them and are the single definition shared by the entity, the SQL filters and
 * the API response.
 */

import type { AccessRole, Capabilities, UserDto } from "./access";

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** The two states a reviewer can move a submission into. */
export const REVIEW_DECISIONS = ["approved", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * A submission is "high risk" when its emissions figure is large or its uncertainty
 * band is wide — either one warrants a closer look before the number is used in
 * reporting.
 *
 * These thresholds are the domain's, not the UI's: the API returns `isHighRisk` on
 * every submission and supports filtering on it, so the frontend never re-implements
 * the rule and the two cannot drift.
 */
export const RISK_THRESHOLDS = {
  /** kg CO2e per unit */
  highEmissionsValue: 500,
  /** percentage points, e.g. 25 means ±25% */
  highUncertaintyPercent: 25,
} as const;

export function isHighRisk(input: {
  emissionsValue: number;
  uncertaintyPercent: number;
}): boolean {
  return (
    input.emissionsValue >= RISK_THRESHOLDS.highEmissionsValue ||
    input.uncertaintyPercent >= RISK_THRESHOLDS.highUncertaintyPercent
  );
}

/** The shape every footprint endpoint returns. Derived from the entity by the mapper. */
export interface ProductFootprintDto {
  id: string;
  /** Who owns the submission. Only the owner can share or delete it. */
  owner: UserDto | null;
  /** The requesting user's role on this submission. */
  accessRole: AccessRole;
  /** What the requesting user may do. Advertised for the UI; enforced server-side. */
  capabilities: Capabilities;
  product: string;
  supplier: string;
  category: string;
  /** kg CO2e per unit */
  emissionsValue: number;
  /** uncertainty as a percentage, e.g. 12 means ±12% */
  uncertaintyPercent: number;
  status: ReviewStatus;
  submittedAt: string;
  supplierNotes: string | null;
  /** Most recent reviewer comment. The full history is on `GET /:id/reviews`. */
  reviewComment: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** Computed server-side from RISK_THRESHOLDS — clients must not recompute it. */
  isHighRisk: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One entry in a submission's review timeline.
 *
 * `status` is the status the submission moved *into* with this decision — the same
 * value as `decision`, exposed under the name the timeline reads in. Both are returned
 * so a client can use whichever fits.
 */
export interface ReviewEventDto {
  id: string;
  footprintId: string;
  decision: ReviewDecision;
  status: ReviewStatus;
  comment: string | null;
  reviewedBy: string;
  createdAt: string;
}

/** One submission a bulk review could not decide, and why. */
export interface BulkReviewFailureDto {
  id: string;
  /** The same `code` the single-submission endpoint would have returned. */
  code: string;
  message: string;
}

/**
 * The outcome of a bulk review, submission by submission.
 *
 * A bulk decision is not all-or-nothing: one submission a colleague already approved
 * must not throw away the reviewer's other nineteen decisions. Both lists are returned
 * so the UI can update the rows that moved and say what happened to the rest.
 */
export interface BulkReviewResultDto {
  succeeded: ProductFootprintDto[];
  failed: BulkReviewFailureDto[];
}

/** Aggregate counts for the queue header. */
export interface FootprintStatsDto {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  highRisk: number;
  /** How many of the visible submissions the caller owns (the rest are shared in). */
  owned: number;
}
