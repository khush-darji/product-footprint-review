import Joi from "joi";
import { email, parser, text } from "../lib/validation";

export interface SignInInput {
  email: string;
  password: string;
}

/**
 * Login input.
 *
 * The password is bounded but has no complexity rule: this validates the shape of a
 * *sign-in* attempt, and rejecting a login because the stored password is "too short"
 * would leak that the account exists. Complexity belongs on registration, which this app
 * does not have.
 *
 * The upper bound is not cosmetic — argon2 hashes whatever it is given, so an unbounded
 * password is unbounded CPU work an attacker can request for free.
 */
export const parseSignIn = parser<SignInInput>(
  Joi.object({
    email: email("Enter a valid email address"),
    password: text("password", 200, "Enter your password"),
  }),
);
