import { SHAREABLE_ROLES } from "../domain/access";
import { Fields } from "../lib/validation";

export interface GrantShareInput {
  email: string;
  role: (typeof SHAREABLE_ROLES)[number];
}

export function parseGrantShare(input: unknown): GrantShareInput {
  const fields = new Fields(input);

  const email = fields.email("email", {
    max: 200,
    message: "Enter the email address of the person to share with",
  });
  // `owner` is deliberately not in SHAREABLE_ROLES: ownership is not transferable here,
  // so asking for it is a validation error rather than a silently ignored field.
  const role = fields.enum("role", SHAREABLE_ROLES, {
    message: 'role must be "editor" or "viewer"',
  });

  fields.done();
  return { email, role };
}

/** `:id` is the footprint, `:userId` is whose access is being revoked. */
export interface ShareParams {
  id: string;
  userId: string;
}

export function parseShareParams(input: unknown): ShareParams {
  const fields = new Fields(input);
  const id = fields.uuid("id", "id must be a UUID");
  const userId = fields.uuid("userId", "userId must be a UUID");
  fields.done();
  return { id, userId };
}
