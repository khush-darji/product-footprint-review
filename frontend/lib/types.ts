/**
 * The API's response shapes, mirrored for the client.
 *
 * Note what is deliberately *not* here: the risk thresholds and the capability table.
 * `isHighRisk` and `capabilities` are computed server-side and returned on every
 * submission, so the rules have exactly one definition. The UI renders them; it never
 * recomputes them, and hiding a button is never the thing that enforces a permission.
 */
export type ReviewStatus = "pending" | "approved" | "rejected";
export type ReviewDecision = "approved" | "rejected";

/** Roles a user can hold on a submission. */
export type AccessRole = "owner" | "editor" | "viewer";
/** Roles an owner can grant. `owner` is not grantable. */
export type ShareableRole = "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  displayName: string;
}

/** What the current user may do with a submission, as decided by the server. */
export interface Capabilities {
  canView: boolean;
  canReview: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
}

export interface ProductFootprint {
  id: string;
  owner: User | null;
  accessRole: AccessRole;
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
  reviewComment: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  isHighRisk: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One decision in a submission's review timeline. */
export interface ReviewEvent {
  id: string;
  footprintId: string;
  decision: ReviewDecision;
  /** The status the submission moved into. Same value as `decision`. */
  status: ReviewStatus;
  comment: string | null;
  reviewedBy: string;
  createdAt: string;
}

/** One submission a bulk review could not decide, and why. */
export interface BulkReviewFailure {
  id: string;
  code: string;
  message: string;
}

/**
 * The outcome of a bulk review, submission by submission.
 *
 * A bulk decision is not all-or-nothing — a submission somebody else decided first is
 * reported here rather than failing the whole request — so the UI has to render both
 * lists, not just check for an error.
 */
export interface BulkReviewResult {
  succeeded: ProductFootprint[];
  failed: BulkReviewFailure[];
}

export interface Share {
  footprintId: string;
  role: ShareableRole;
  user: User;
  grantedBy: User | null;
  createdAt: string;
}

export type SortKey = "submittedAt" | "emissionsValue" | "uncertaintyPercent";
export type SortOrder = "asc" | "desc";
export type QueueScope = "all" | "owned" | "shared";

export interface PageInfo {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
  sort: SortKey;
  order: SortOrder;
}

export interface FootprintListResponse {
  items: ProductFootprint[];
  total: number;
  pageInfo: PageInfo;
}

export interface FootprintStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  highRisk: number;
  owned: number;
}

/** The error envelope every failing endpoint returns. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
    requestId?: string;
  };
}
