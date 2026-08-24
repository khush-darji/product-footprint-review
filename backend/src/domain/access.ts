/**
 * The access-control model, in one file.
 *
 * A footprint has exactly one **owner** (the user who created it). The owner can share
 * it with other users as a **viewer** or an **editor**. Nobody else can see it at all.
 *
 * | Capability          | Owner | Editor | Viewer | No access |
 * |---------------------|-------|--------|--------|-----------|
 * | View the submission | yes   | yes    | yes    | no (404)  |
 * | View review history | yes   | yes    | yes    | no (404)  |
 * | Approve / reject    | yes   | yes    | no     | no        |
 * | Edit while pending  | yes   | yes    | no     | no        |
 * | Share / change role | yes   | no     | no     | no        |
 * | Revoke access       | yes   | no     | no     | no        |
 * | Delete              | yes   | no     | no     | no        |
 *
 * Two rules make this hold in practice, and both live below the HTTP layer:
 *
 *  1. **Reads are scoped, not filtered.** Every query is constrained to rows the caller
 *     owns or has a share on, so there is no code path that fetches a row and then
 *     decides whether to hide it — the row never leaves the database.
 *  2. **No access is a 404, not a 403.** Telling an unauthorised caller "403" confirms
 *     the submission exists. Only a caller who can already see the row gets a 403, and
 *     only for an action their role does not permit.
 *
 * The functions here are pure: no Express, no TypeORM. They are the single definition
 * the services enforce and the API advertises back to the UI.
 */

/** Roles a user can hold on a footprint, most privileged first. */
export const ACCESS_ROLES = ["owner", "editor", "viewer"] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

/** Roles an owner can grant to somebody else. `owner` is not grantable. */
export const SHAREABLE_ROLES = ["editor", "viewer"] as const;
export type ShareableRole = (typeof SHAREABLE_ROLES)[number];

/** What the caller may do with a particular submission. */
export interface Capabilities {
  canView: boolean;
  canReview: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
}

const CAPABILITIES: Record<AccessRole, Capabilities> = {
  owner: { canView: true, canReview: true, canEdit: true, canShare: true, canDelete: true },
  editor: { canView: true, canReview: true, canEdit: true, canShare: false, canDelete: false },
  viewer: { canView: true, canReview: false, canEdit: false, canShare: false, canDelete: false },
};

export function capabilitiesFor(role: AccessRole): Capabilities {
  return CAPABILITIES[role];
}

export function canReview(role: AccessRole): boolean {
  return CAPABILITIES[role].canReview;
}

export function canEdit(role: AccessRole): boolean {
  return CAPABILITIES[role].canEdit;
}

/** Sharing, revoking, changing a role and deleting are all owner-only. */
export function canManage(role: AccessRole): boolean {
  return role === "owner";
}

/** A user as returned by the API. No token, ever. */
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
}

/** One grant of access on a submission. */
export interface ShareDto {
  footprintId: string;
  role: ShareableRole;
  user: UserDto;
  grantedBy: UserDto | null;
  createdAt: string;
}
