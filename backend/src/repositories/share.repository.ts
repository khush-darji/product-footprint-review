/**
 * Queries against `footprint_shares`.
 *
 * Callers must have already established that the acting user may manage the footprint —
 * these functions take a `footprintId` that the service has authorised, and do not
 * re-derive permission themselves.
 */
import { AppDataSource } from "../db/data-source";
import type { ShareableRole } from "../domain/access";
import { FootprintShare } from "../entities/footprint-share.entity";

function repo() {
  return AppDataSource.getRepository(FootprintShare);
}

/** All grants on a submission, with both users joined for display. */
export async function findByFootprint(footprintId: string): Promise<FootprintShare[]> {
  return repo().find({
    where: { footprintId },
    // Joined in one query rather than a lookup per row — this is the classic N+1 spot.
    relations: { user: true, grantedBy: true },
    order: { createdAt: "ASC" },
  });
}

export async function findOne(
  footprintId: string,
  userId: string,
): Promise<FootprintShare | null> {
  return repo().findOne({
    where: { footprintId, userId },
    relations: { user: true, grantedBy: true },
  });
}

/**
 * Grants access, or updates the role if the user already has a grant.
 *
 * An upsert rather than an insert: re-sharing with a different role is the natural way
 * to change someone's access, and the unique constraint would otherwise turn it into a
 * confusing 409.
 */
export async function grant(
  footprintId: string,
  userId: string,
  role: ShareableRole,
  grantedById: string,
): Promise<FootprintShare> {
  await repo()
    .createQueryBuilder()
    .insert()
    .into(FootprintShare)
    .values({ footprintId, userId, role, grantedById })
    .orUpdate(["role", "granted_by_id"], ["footprint_id", "user_id"])
    .execute();

  // Re-read so the caller gets the joined users and the real timestamps.
  const share = await findOne(footprintId, userId);
  if (!share) {
    throw new Error("share upsert did not produce a row");
  }
  return share;
}

export async function revoke(footprintId: string, userId: string): Promise<boolean> {
  const result = await repo().delete({ footprintId, userId });
  return (result.affected ?? 0) > 0;
}
