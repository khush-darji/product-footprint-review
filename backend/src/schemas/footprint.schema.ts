/**
 * The API's boundary contract for footprint endpoints.
 *
 * Each schema **names every field it accepts**, and the compiler strips anything else
 * before the value reaches a service — which is what stops a client approving its own
 * submission by posting `{ status: "approved" }`. Nothing here copies the request object.
 *
 * Every string is length-bounded and every number has a range: an unbounded field is a
 * denial of service that needs no exploit.
 */
import Joi from "joi";
import { REVIEW_DECISIONS, REVIEW_STATUSES } from "../domain/footprint";
import {
  boundedInt,
  boundedNumber,
  nullableText,
  oneOf,
  optionalText,
  parser,
  text,
  uuid,
  uuidItem,
} from "../lib/validation";
import { SORT_COLUMNS } from "../repositories/footprint.repository";

const SORT_KEYS = Object.keys(SORT_COLUMNS) as (keyof typeof SORT_COLUMNS)[];
const SCOPES = ["all", "owned", "shared"] as const;
const ORDERS = ["asc", "desc"] as const;
const STATUS_FILTERS = [...REVIEW_STATUSES, "all"] as const;

const DECISION = oneOf("decision", REVIEW_DECISIONS, 'decision must be "approved" or "rejected"');

export interface UuidParam {
  id: string;
}

export const parseUuidParam = parser<UuidParam>(Joi.object({ id: uuid() }));

export interface ListFootprintsQuery {
  status: (typeof STATUS_FILTERS)[number];
  q?: string | undefined;
  category?: string | undefined;
  supplier?: string | undefined;
  scope: (typeof SCOPES)[number];
  highRiskOnly: boolean;
  sort: keyof typeof SORT_COLUMNS;
  order: (typeof ORDERS)[number];
  limit: number;
  cursor?: string | undefined;
}

export const parseListFootprintsQuery = parser<ListFootprintsQuery>(
  Joi.object({
    // `all` is an explicit "no status filter" rather than an omission.
    status: oneOf("status", STATUS_FILTERS).default("all"),
    q: optionalText("q", 200),
    category: optionalText("category", 100),
    supplier: optionalText("supplier", 200),
    scope: oneOf("scope", SCOPES).default("all"),
    highRiskOnly: Joi.boolean()
      .default(false)
      .messages({ "boolean.base": 'highRiskOnly must be "true" or "false"' }),
    /* The allowlist is the repository's column map, so adding a sort option in one place
     * without the other is a compile error rather than an injection. */
    sort: oneOf("sort", SORT_KEYS).default("submittedAt"),
    order: oneOf("order", ORDERS).default("desc"),
    /* Bounded so a client cannot ask for the whole table in one request. */
    limit: boundedInt("limit", 1, 100, 25),
    /* Opaque keyset cursor from a previous page's `pageInfo.nextCursor`. */
    cursor: optionalText("cursor", 400),
  }),
);

export interface CreateFootprintInput {
  product: string;
  supplier: string;
  category: string;
  emissionsValue: number;
  uncertaintyPercent: number;
  supplierNotes: string | null;
  submittedAt: Date;
}

/**
 * A supplier may backdate a submission, but not post-date one. The minute of slack
 * absorbs clock skew between the client and the server, and `Joi.date()` accepts the ISO
 * 8601 string the API documents.
 */
const submittedAt = Joi.date()
  .default(() => new Date())
  // Not `.max("now")`: that would reject a timestamp a millisecond ahead of the server's
  // clock, which is a normal amount of skew rather than a client backdating anything.
  .custom((value: Date, helpers) =>
    value.getTime() > Date.now() + 60_000 ? helpers.error("date.future") : value,
  )
  .messages({
    "date.base": "submittedAt must be an ISO 8601 datetime",
    "date.future": "submittedAt cannot be in the future",
  });

export const parseCreateFootprint = parser<CreateFootprintInput>(
  Joi.object({
    product: text("product", 200),
    supplier: text("supplier", 200),
    category: text("category", 100),
    emissionsValue: boundedNumber("emissionsValue", 0, 1_000_000_000),
    uncertaintyPercent: boundedNumber("uncertaintyPercent", 0, 100),
    supplierNotes: nullableText("supplierNotes", 2_000).default(null),
    submittedAt,
  }),
);

/**
 * Corrections to a submission that has not been reviewed yet.
 *
 * `status`, `reviewedBy` and friends are absent on purpose: accepting them here would let
 * a client approve a submission through the update endpoint, bypassing the review flow.
 * The fix is to never name the field, not to filter it afterwards.
 */
export type UpdateFootprintInput = Partial<
  Pick<
    CreateFootprintInput,
    | "product"
    | "supplier"
    | "category"
    | "emissionsValue"
    | "uncertaintyPercent"
    | "supplierNotes"
  >
>;

export const parseUpdateFootprint = parser<UpdateFootprintInput>(
  Joi.object({
    product: text("product", 200).optional(),
    supplier: text("supplier", 200).optional(),
    category: text("category", 100).optional(),
    emissionsValue: boundedNumber("emissionsValue", 0, 1_000_000_000).optional(),
    uncertaintyPercent: boundedNumber("uncertaintyPercent", 0, 100).optional(),
    // No `.default(null)` here, unlike create: a key that was not sent must stay absent
    // so the repository leaves the column alone, while an explicit `null` clears it.
    supplierNotes: nullableText("supplierNotes", 2_000),
  })
    // An empty body would otherwise be a successful no-op that looks like an edit.
    .min(1)
    .messages({ "object.min": "Provide at least one field to update" }),
);

export interface ReviewFootprintInput {
  decision: (typeof REVIEW_DECISIONS)[number];
  comment: string | null;
}

export const parseReviewFootprint = parser<ReviewFootprintInput>(
  Joi.object({
    decision: DECISION.required(),
    // Optional on both decisions — the decision itself is the signal that matters, and a
    // reviewer rejecting an obviously bad submission should not be blocked on prose.
    comment: nullableText("comment", 2_000).default(null),
  }),
);

/**
 * How many submissions one bulk request may decide.
 *
 * Each id costs a locking transaction, so the cap is what stops a single request from
 * holding the connection — and rows other reviewers are waiting on — indefinitely. The
 * UI pages at 25, so a full page and then some fits in one call.
 */
export const BULK_REVIEW_MAX_IDS = 100;

export interface BulkReviewInput {
  ids: string[];
  decision: (typeof REVIEW_DECISIONS)[number];
  comment: string | null;
}

export const parseBulkReview = parser<BulkReviewInput>(
  Joi.object({
    ids: Joi.array()
      .items(uuidItem())
      .min(1)
      // The cap is checked against what was sent, before de-duplication, so a caller
      // cannot slip past it with a padded list.
      .max(BULK_REVIEW_MAX_IDS)
      // Duplicates are collapsed rather than rejected. Left in, the second copy of an id
      // would be reviewed against a row the first copy had just decided and report itself
      // as a conflict against its own batch.
      .custom((value: string[]) => [...new Set(value)])
      .required()
      .messages({
        "any.required": "ids must contain at least one id",
        "array.base": "ids must be an array of ids",
        "array.min": "ids must contain at least one id",
        "array.max": `ids must contain at most ${BULK_REVIEW_MAX_IDS} ids`,
      }),
    decision: DECISION.required(),
    // One comment for the whole batch — a bulk decision has one reason behind it ("missing
    // verification evidence"), and it is recorded against every submission in the batch.
    // Wording a distinct note per submission is what the single-submission endpoint is for.
    comment: nullableText("comment", 2_000).default(null),
  }),
);

export interface ListReviewsQuery {
  limit: number;
}

export const parseListReviewsQuery = parser<ListReviewsQuery>(
  Joi.object({ limit: boundedInt("limit", 1, 100, 50) }),
);
