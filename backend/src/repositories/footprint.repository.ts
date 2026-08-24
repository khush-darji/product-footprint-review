/**
 * Every query against `product_footprints` lives here.
 *
 * The access rule is enforced in this file rather than above it, and it is enforced by
 * **scoping the query**, not by fetching a row and then deciding whether to return it:
 * every read joins the caller's grants and constrains the WHERE clause, so a row the
 * caller cannot see never leaves the database. There is no code path that loads a
 * submission without a `userId`.
 *
 * The repository still does not decide *policy* — whether a viewer may approve is the
 * service's call. It decides visibility, because that has to happen in SQL.
 */
import type { DataSource, EntityManager, SelectQueryBuilder } from "typeorm";
import { AppDataSource } from "../db/data-source";
import type { AccessRole } from "../domain/access";
import {
  RISK_THRESHOLDS,
  type FootprintStatsDto,
  type ReviewDecision,
  type ReviewStatus,
} from "../domain/footprint";
import { ProductFootprint } from "../entities/product-footprint.entity";
import { ReviewEvent } from "../entities/review-event.entity";
import type { Cursor, SortDirection } from "../lib/pagination";

export interface ListFilters {
  status: ReviewStatus | "all";
  search?: string | undefined;
  category?: string | undefined;
  supplier?: string | undefined;
  highRiskOnly: boolean;
  /** `owned` = submissions I own, `shared` = ones shared with me, `all` = both. */
  scope: "all" | "owned" | "shared";
}

/**
 * Sortable columns, mapped to SQL identifiers.
 *
 * An identifier can never be a bound parameter, so this map *is* the allowlist —
 * interpolating a client-supplied column name into ORDER BY would be an injection. The
 * Zod schema only accepts these keys, and this map is the second gate.
 */
export const SORT_COLUMNS = {
  submittedAt: "submitted_at",
  emissionsValue: "emissions_value",
  uncertaintyPercent: "uncertainty_percent",
} as const;

export type SortKey = keyof typeof SORT_COLUMNS;

export interface CreateFootprintData {
  ownerId: string;
  product: string;
  supplier: string;
  category: string;
  emissionsValue: number;
  uncertaintyPercent: number;
  supplierNotes: string | null;
  submittedAt: Date;
}

export type UpdateFootprintData = Partial<
  Omit<CreateFootprintData, "submittedAt" | "ownerId">
>;

/** A submission plus the role the requesting user holds on it. */
export interface AccessibleFootprint {
  footprint: ProductFootprint;
  role: AccessRole;
}

const ALIAS = "footprint";
// Not "grant": that is a reserved SQL keyword, and it appears unquoted inside the
// raw CASE expression below.
const SHARE_ALIAS = "access_grant";

/**
 * `%` and `_` are wildcards in LIKE, so a search for "50%" would otherwise match far
 * more than the user meant. Escaping them keeps the search literal. (This is about
 * correctness, not injection — the value is always bound as a parameter.)
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function dataSource(): DataSource {
  return AppDataSource;
}

function repo(manager?: EntityManager) {
  return (manager ?? dataSource().manager).getRepository(ProductFootprint);
}

/**
 * The heart of the access model: a query that can only ever see rows the user owns or
 * has been granted.
 *
 * The LEFT JOIN cannot multiply rows — `footprint_shares` has a unique constraint on
 * (footprint_id, user_id) — so the raw result stays aligned with the entity result and
 * the role can be read off alongside it.
 */
function accessibleQuery(
  userId: string,
  manager?: EntityManager,
): SelectQueryBuilder<ProductFootprint> {
  return repo(manager)
    .createQueryBuilder(ALIAS)
    /* Owner joined in the same query rather than looked up per row — this is the
     * classic N+1 spot on a list endpoint. `api_token_hash` is `select: false` on the
     * entity, so joining the user here cannot leak the credential. */
    .leftJoinAndSelect(`${ALIAS}.owner`, "owner")
    .leftJoin(
      "footprint_shares",
      SHARE_ALIAS,
      `${SHARE_ALIAS}.footprint_id = ${ALIAS}.id AND ${SHARE_ALIAS}.user_id = :accessUserId`,
      { accessUserId: userId },
    )
    /* Both branches are cast to text on purpose. `grant.role` is the `share_role` enum,
     * which has only 'editor' and 'viewer', so without the cast Postgres tries to
     * coerce the literal 'owner' into that enum and the whole query fails with
     * `invalid input value for enum share_role: "owner"`. */
    .addSelect(
      `CASE WHEN ${ALIAS}.owner_id = :accessUserId THEN 'owner'::text ELSE ${SHARE_ALIAS}.role::text END`,
      "access_role",
    )
    .where(`(${ALIAS}.owner_id = :accessUserId OR ${SHARE_ALIAS}.id IS NOT NULL)`);
}

/** Applies the shared filter clauses used by both the list query and the count. */
function applyFilters(
  qb: SelectQueryBuilder<ProductFootprint>,
  filters: ListFilters,
  userId: string,
): SelectQueryBuilder<ProductFootprint> {
  if (filters.status !== "all") {
    qb.andWhere(`${ALIAS}.status = :status`, { status: filters.status });
  }

  if (filters.search) {
    const pattern = `%${escapeLikePattern(filters.search)}%`;
    qb.andWhere(
      `(${ALIAS}.product ILIKE :pattern ESCAPE '\\' OR ${ALIAS}.supplier ILIKE :pattern ESCAPE '\\')`,
      { pattern },
    );
  }

  if (filters.category) {
    qb.andWhere(`${ALIAS}.category = :category`, { category: filters.category });
  }

  if (filters.supplier) {
    qb.andWhere(`${ALIAS}.supplier = :supplier`, { supplier: filters.supplier });
  }

  if (filters.highRiskOnly) {
    qb.andWhere(
      `(${ALIAS}.emissions_value >= :highEmissions OR ${ALIAS}.uncertainty_percent >= :highUncertainty)`,
      {
        highEmissions: RISK_THRESHOLDS.highEmissionsValue,
        highUncertainty: RISK_THRESHOLDS.highUncertaintyPercent,
      },
    );
  }

  if (filters.scope === "owned") {
    qb.andWhere(`${ALIAS}.owner_id = :ownerScopeId`, { ownerScopeId: userId });
  } else if (filters.scope === "shared") {
    qb.andWhere(`${ALIAS}.owner_id <> :ownerScopeId`, { ownerScopeId: userId });
  }

  return qb;
}

/** Reads the computed role off a raw row, defaulting to the least privilege. */
function roleFromRaw(raw: Record<string, unknown> | undefined): AccessRole {
  const value = raw?.["access_role"];
  return value === "owner" || value === "editor" ? value : "viewer";
}

/**
 * One page of the queue, ordered by the requested sort with an id tiebreak.
 *
 * Fetches `limit + 1` rows: the extra row reveals whether another page exists without a
 * second query.
 */
export async function findPage(
  userId: string,
  filters: ListFilters,
  sort: SortKey,
  direction: SortDirection,
  limit: number,
  cursor?: Cursor,
): Promise<AccessibleFootprint[]> {
  const column = SORT_COLUMNS[sort];
  const qb = applyFilters(accessibleQuery(userId), filters, userId);

  if (cursor) {
    // Row-value comparison, matching the (sort column, id) order exactly so Postgres can
    // use the index rather than filtering after the fact.
    const comparator = direction === "desc" ? "<" : ">";
    qb.andWhere(
      `(${ALIAS}.${column}, ${ALIAS}.id) ${comparator} (:cursorValue, :cursorId)`,
      {
        // submittedAt is a timestamptz; the other two are numeric. Passing the right JS
        // type stops the driver comparing a string against a number.
        cursorValue:
          sort === "submittedAt" ? new Date(cursor.sortValue) : Number(cursor.sortValue),
        cursorId: cursor.id,
      },
    );
  }

  const order = direction === "desc" ? "DESC" : "ASC";
  const { entities, raw } = await qb
    .orderBy(`${ALIAS}.${column}`, order)
    // The id tiebreak is what makes the cursor stable: without it, two rows with equal
    // sort values could straddle a page boundary in either order.
    .addOrderBy(`${ALIAS}.id`, order)
    .limit(limit + 1)
    .getRawAndEntities();

  return entities.map((footprint, index) => ({
    footprint,
    role: roleFromRaw(raw[index] as Record<string, unknown> | undefined),
  }));
}

export async function countMatching(userId: string, filters: ListFilters): Promise<number> {
  return applyFilters(accessibleQuery(userId), filters, userId).getCount();
}

/**
 * One submission, or null when the caller has no access to it.
 *
 * Null covers both "does not exist" and "exists but is not yours" on purpose — the
 * caller turns both into a 404, because a 403 would confirm the row exists.
 */
export async function findAccessibleById(
  userId: string,
  id: string,
  manager?: EntityManager,
): Promise<AccessibleFootprint | null> {
  const { entities, raw } = await accessibleQuery(userId, manager)
    .andWhere(`${ALIAS}.id = :id`, { id })
    .getRawAndEntities();

  const footprint = entities[0];
  if (!footprint) return null;

  return { footprint, role: roleFromRaw(raw[0] as Record<string, unknown> | undefined) };
}

export async function create(data: CreateFootprintData): Promise<ProductFootprint> {
  const footprint = repo().create({ ...data, status: "pending" });
  return repo().save(footprint);
}

export async function update(
  id: string,
  data: UpdateFootprintData,
): Promise<ProductFootprint | null> {
  // Fields are applied from a typed object rather than spreading request input, so
  // there is no path by which a client-supplied `status` or `ownerId` reaches the row.
  await repo().update({ id }, data);
  return repo().findOne({ where: { id } });
}

export async function remove(id: string): Promise<boolean> {
  const result = await repo().delete({ id });
  return (result.affected ?? 0) > 0;
}

export type ReviewOutcome =
  | { kind: "reviewed"; footprint: ProductFootprint }
  | { kind: "not_found" }
  | { kind: "already_reviewed"; status: ReviewStatus };

/**
 * Records a decision and appends it to the timeline, atomically.
 *
 * The `SELECT ... FOR UPDATE` is the important part. Reading the row, checking that it
 * is still pending, and then writing would let two concurrent approvals both pass the
 * check and both write — the classic read-modify-write race. The row lock serialises
 * them, so the second re-reads the committed row, sees a non-pending status, and is
 * reported as a conflict instead of overwriting the first reviewer's decision.
 *
 * Access is re-checked *inside* the transaction: a grant revoked between the service's
 * check and this write must not still let the review land.
 */
export async function recordReview(
  userId: string,
  id: string,
  decision: ReviewDecision,
  comment: string | null,
  reviewedBy: string,
): Promise<ReviewOutcome> {
  return dataSource().transaction(async (manager) => {
    const accessible = await findAccessibleById(userId, id, manager);
    if (!accessible) return { kind: "not_found" };

    const locked = await manager
      .getRepository(ProductFootprint)
      .createQueryBuilder(ALIAS)
      .setLock("pessimistic_write")
      .where(`${ALIAS}.id = :id`, { id })
      .getOne();

    if (!locked) return { kind: "not_found" };
    if (locked.status !== "pending") {
      return { kind: "already_reviewed", status: locked.status };
    }

    const reviewedAt = new Date();

    await manager
      .getRepository(ProductFootprint)
      .update({ id }, { status: decision, reviewComment: comment, reviewedAt, reviewedBy });

    await manager
      .getRepository(ReviewEvent)
      .insert({ footprintId: id, decision, comment, reviewedBy });

    const updated = await manager
      .getRepository(ProductFootprint)
      .findOneOrFail({ where: { id } });

    return { kind: "reviewed", footprint: updated };
  });
}

export async function findReviewEvents(
  footprintId: string,
  limit: number,
): Promise<ReviewEvent[]> {
  return dataSource()
    .getRepository(ReviewEvent)
    .find({ where: { footprintId }, order: { createdAt: "DESC" }, take: limit });
}

/**
 * Queue counts for the header, scoped to what the caller can see.
 *
 * One query with FILTER aggregates rather than several round trips — and because it is
 * a single scan, the numbers agree with each other rather than being separate snapshots
 * taken at slightly different times.
 */
export async function getStats(userId: string): Promise<FootprintStatsDto> {
  const [row] = (await accessibleQuery(userId)
    .select("COUNT(*)::int", "total")
    .addSelect(`COUNT(*) FILTER (WHERE ${ALIAS}.status = 'pending')::int`, "pending")
    .addSelect(`COUNT(*) FILTER (WHERE ${ALIAS}.status = 'approved')::int`, "approved")
    .addSelect(`COUNT(*) FILTER (WHERE ${ALIAS}.status = 'rejected')::int`, "rejected")
    .addSelect(
      `COUNT(*) FILTER (WHERE ${ALIAS}.emissions_value >= :highEmissions OR ${ALIAS}.uncertainty_percent >= :highUncertainty)::int`,
      "highRisk",
    )
    .addSelect(`COUNT(*) FILTER (WHERE ${ALIAS}.owner_id = :accessUserId)::int`, "owned")
    .setParameters({
      highEmissions: RISK_THRESHOLDS.highEmissionsValue,
      highUncertainty: RISK_THRESHOLDS.highUncertaintyPercent,
    })
    .getRawMany<FootprintStatsDto>()) as [FootprintStatsDto];

  return row;
}
