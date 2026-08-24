/**
 * Entity -> API response.
 *
 * An explicit mapper rather than returning entities directly, for three reasons: adding
 * a column stops being an accidental API change, the response can carry derived fields
 * (`isHighRisk`, `capabilities`) the row does not have, and — most importantly here —
 * it is the choke point that stops a joined `User` entity leaking its token hash.
 */
import {
  capabilitiesFor,
  type AccessRole,
  type ShareDto,
  type UserDto,
} from "../domain/access";
import {
  isHighRisk,
  type ProductFootprintDto,
  type ReviewEventDto,
} from "../domain/footprint";
import type { FootprintShare } from "../entities/footprint-share.entity";
import type { ProductFootprint } from "../entities/product-footprint.entity";
import type { ReviewEvent } from "../entities/review-event.entity";
import type { User } from "../entities/user.entity";

/** Never spreads the entity: `apiTokenHash` must not reach a response. */
export function toUserDto(user: User): UserDto {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

export function toFootprintDto(
  entity: ProductFootprint,
  role: AccessRole,
): ProductFootprintDto {
  return {
    id: entity.id,
    owner: entity.owner ? toUserDto(entity.owner) : null,
    accessRole: role,
    capabilities: capabilitiesFor(role),
    product: entity.product,
    supplier: entity.supplier,
    category: entity.category,
    emissionsValue: entity.emissionsValue,
    uncertaintyPercent: entity.uncertaintyPercent,
    status: entity.status,
    submittedAt: entity.submittedAt.toISOString(),
    supplierNotes: entity.supplierNotes,
    reviewComment: entity.reviewComment,
    reviewedAt: entity.reviewedAt?.toISOString() ?? null,
    reviewedBy: entity.reviewedBy,
    isHighRisk: isHighRisk(entity),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toReviewEventDto(entity: ReviewEvent): ReviewEventDto {
  return {
    id: entity.id,
    footprintId: entity.footprintId,
    decision: entity.decision,
    // The status the submission moved into, which is what the timeline renders.
    status: entity.decision,
    comment: entity.comment,
    reviewedBy: entity.reviewedBy,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toShareDto(entity: FootprintShare): ShareDto {
  return {
    footprintId: entity.footprintId,
    role: entity.role,
    user: entity.user
      ? toUserDto(entity.user)
      : { id: entity.userId, email: "", displayName: "Unknown user" },
    grantedBy: entity.grantedBy ? toUserDto(entity.grantedBy) : null,
    createdAt: entity.createdAt.toISOString(),
  };
}
