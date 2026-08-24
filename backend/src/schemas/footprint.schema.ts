/**
 * The API's boundary contract for footprint endpoints.
 *
 * Each parser validates the raw input and **builds its result field by field**. Nothing
 * is spread or copied from the request, so a key the schema does not name cannot reach a
 * service — which is what stops a client approving its own submission by posting
 * `{ status: "approved" }`.
 *
 * Every string is length-bounded and every number has a range: an unbounded field is a
 * denial of service that needs no exploit.
 */
import { REVIEW_DECISIONS, REVIEW_STATUSES } from "../domain/footprint";
import { Fields } from "../lib/validation";
import { SORT_COLUMNS } from "../repositories/footprint.repository";

const SORT_KEYS = Object.keys(SORT_COLUMNS) as (keyof typeof SORT_COLUMNS)[];
const SCOPES = ["all", "owned", "shared"] as const;
const ORDERS = ["asc", "desc"] as const;
const STATUS_FILTERS = [...REVIEW_STATUSES, "all"] as const;

export interface UuidParam {
  id: string;
}

export function parseUuidParam(input: unknown): UuidParam {
  const fields = new Fields(input);
  const id = fields.uuid("id", "id must be a UUID");
  fields.done();
  return { id };
}

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

export function parseListFootprintsQuery(input: unknown): ListFootprintsQuery {
  const fields = new Fields(input);

  const query: ListFootprintsQuery = {
    // `all` is an explicit "no status filter" rather than an omission.
    status: fields.enum("status", STATUS_FILTERS, { fallback: "all" }),
    q: fields.optionalString("q", { max: 200 }),
    category: fields.optionalString("category", { max: 100 }),
    supplier: fields.optionalString("supplier", { max: 200 }),
    scope: fields.enum("scope", SCOPES, { fallback: "all" }),
    highRiskOnly: fields.boolFromQuery("highRiskOnly", false),
    /* The allowlist is the repository's column map, so adding a sort option in one place
     * without the other is a compile error rather than an injection. */
    sort: fields.enum("sort", SORT_KEYS, { fallback: "submittedAt" }),
    order: fields.enum("order", ORDERS, { fallback: "desc" }),
    /* Bounded so a client cannot ask for the whole table in one request. */
    limit: fields.intFromQuery("limit", { min: 1, max: 100, fallback: 25 }),
    /* Opaque keyset cursor from a previous page's `pageInfo.nextCursor`. */
    cursor: fields.optionalString("cursor", { max: 400 }),
  };

  fields.done();
  return query;
}

export interface CreateFootprintInput {
  product: string;
  supplier: string;
  category: string;
  emissionsValue: number;
  uncertaintyPercent: number;
  supplierNotes: string | null;
  submittedAt: Date;
}

export function parseCreateFootprint(input: unknown): CreateFootprintInput {
  const fields = new Fields(input);

  const product = fields.string("product", { max: 200 });
  const supplier = fields.string("supplier", { max: 200 });
  const category = fields.string("category", { max: 100 });
  const emissionsValue = fields.number("emissionsValue", { min: 0, max: 1_000_000_000 });
  const uncertaintyPercent = fields.number("uncertaintyPercent", { min: 0, max: 100 });
  const supplierNotes = fields.nullableText("supplierNotes", { max: 2_000 });

  const submitted = fields.optionalIsoDate(
    "submittedAt",
    "submittedAt must be an ISO 8601 datetime",
  );
  // A supplier may backdate a submission, but not post-date one. The minute of slack
  // absorbs clock skew between the client and the server.
  if (submitted && submitted.getTime() > Date.now() + 60_000) {
    fields.reject("submittedAt", "submittedAt cannot be in the future");
  }

  fields.done();

  return {
    product,
    supplier,
    category,
    emissionsValue,
    uncertaintyPercent,
    supplierNotes,
    submittedAt: submitted ?? new Date(),
  };
}

/**
 * Corrections to a submission that has not been reviewed yet.
 *
 * `status`, `reviewedBy` and friends are absent on purpose: accepting them here would let
 * a client approve a submission through the update endpoint, bypassing the review flow.
 * The fix is to never read the field, not to filter it afterwards.
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

export function parseUpdateFootprint(input: unknown): UpdateFootprintInput {
  const fields = new Fields(input);
  const update: UpdateFootprintInput = {};

  if (fields.has("product")) update.product = fields.string("product", { max: 200 });
  if (fields.has("supplier")) update.supplier = fields.string("supplier", { max: 200 });
  if (fields.has("category")) update.category = fields.string("category", { max: 100 });
  if (fields.has("emissionsValue")) {
    update.emissionsValue = fields.number("emissionsValue", { min: 0, max: 1_000_000_000 });
  }
  if (fields.has("uncertaintyPercent")) {
    update.uncertaintyPercent = fields.number("uncertaintyPercent", { min: 0, max: 100 });
  }
  // Presence rather than truthiness, so a caller can deliberately clear the notes.
  if (fields.hasKey("supplierNotes")) {
    update.supplierNotes = fields.nullableText("supplierNotes", { max: 2_000 });
  }

  if (Object.keys(update).length === 0) {
    fields.reject("body", "Provide at least one field to update");
  }

  fields.done();
  return update;
}

export interface ReviewFootprintInput {
  decision: (typeof REVIEW_DECISIONS)[number];
  comment: string | null;
}

export function parseReviewFootprint(input: unknown): ReviewFootprintInput {
  const fields = new Fields(input);

  const decision = fields.enum("decision", REVIEW_DECISIONS, {
    message: 'decision must be "approved" or "rejected"',
  });
  // Optional on both decisions — the decision itself is the signal that matters, and a
  // reviewer rejecting an obviously bad submission should not be blocked on prose.
  const comment = fields.nullableText("comment", { max: 2_000 });

  fields.done();
  return { decision, comment };
}

export interface ListReviewsQuery {
  limit: number;
}

export function parseListReviewsQuery(input: unknown): ListReviewsQuery {
  const fields = new Fields(input);
  const limit = fields.intFromQuery("limit", { min: 1, max: 100, fallback: 50 });
  fields.done();
  return { limit };
}
