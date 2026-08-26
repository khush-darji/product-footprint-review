import Joi from "joi";
import { SHAREABLE_ROLES } from "../domain/access";
import { email, oneOf, parser, uuid } from "../lib/validation";

export interface GrantShareInput {
  email: string;
  role: (typeof SHAREABLE_ROLES)[number];
}

export const parseGrantShare = parser<GrantShareInput>(
  Joi.object({
    email: email("Enter the email address of the person to share with"),
    // `owner` is deliberately not in SHAREABLE_ROLES: ownership is not transferable here,
    // so asking for it is a validation error rather than a silently ignored field.
    role: oneOf("role", SHAREABLE_ROLES, 'role must be "editor" or "viewer"').required(),
  }),
);

/** `:id` is the footprint, `:userId` is whose access is being revoked. */
export interface ShareParams {
  id: string;
  userId: string;
}

export const parseShareParams = parser<ShareParams>(
  Joi.object({
    id: uuid(),
    userId: uuid(),
  }),
);
