/**
 * Granting, changing and revoking access to a submission.
 *
 * Every function here starts the same way: load the submission through the access-scoped
 * query (404 if the caller cannot see it at all), then require the `owner` role. Sharing
 * is owner-only by design — an editor who could re-share would be able to widen access
 * beyond what the owner granted, which is how "share with one colleague" quietly becomes
 * "share with the department".
 */
import { canManage, type ShareDto } from "../domain/access";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { toShareDto } from "../mappers/footprint.mapper";
import type { AuthenticatedUser } from "../middleware/auth";
import * as footprintRepo from "../repositories/footprint.repository";
import * as shareRepo from "../repositories/share.repository";
import * as userRepo from "../repositories/user.repository";
import type { GrantShareInput } from "../schemas/share.schema";

/** 404 if the caller cannot see it, 403 if they can see it but do not own it. */
async function requireOwnership(user: AuthenticatedUser, footprintId: string): Promise<void> {
  const accessible = await footprintRepo.findAccessibleById(user.id, footprintId);
  if (!accessible) {
    throw new NotFoundError(`No submission found with id "${footprintId}"`);
  }
  if (!canManage(accessible.role)) {
    throw new ForbiddenError("Only the owner can manage sharing for this submission.");
  }
}

export async function listShares(
  user: AuthenticatedUser,
  footprintId: string,
): Promise<ShareDto[]> {
  await requireOwnership(user, footprintId);
  const shares = await shareRepo.findByFootprint(footprintId);
  return shares.map(toShareDto);
}

/**
 * Grants access by email, or updates the role if the user already has a grant.
 *
 * Resolving by email rather than by id keeps the client from having to enumerate users
 * to share with someone, and the error for an unknown address is explicit — this is an
 * internal directory, so "no account" is a useful message rather than an oracle worth
 * protecting.
 */
export async function grantShare(
  user: AuthenticatedUser,
  footprintId: string,
  input: GrantShareInput,
): Promise<ShareDto> {
  await requireOwnership(user, footprintId);

  const recipient = await userRepo.findByEmail(input.email);
  if (!recipient) {
    throw new ValidationError(`No user found with email "${input.email}"`);
  }

  // The owner already has full access; a share row for them would create two competing
  // sources of truth for their role.
  if (recipient.id === user.id) {
    throw new ConflictError("You already own this submission.");
  }

  const share = await shareRepo.grant(footprintId, recipient.id, input.role, user.id);
  return toShareDto(share);
}

/**
 * Revokes a grant. Idempotent from the caller's point of view is *not* what we want
 * here — a 404 tells an owner that the person they thought had access did not.
 */
export async function revokeShare(
  user: AuthenticatedUser,
  footprintId: string,
  userId: string,
): Promise<void> {
  await requireOwnership(user, footprintId);

  const revoked = await shareRepo.revoke(footprintId, userId);
  if (!revoked) {
    throw new NotFoundError("That user does not have access to this submission.");
  }
}
