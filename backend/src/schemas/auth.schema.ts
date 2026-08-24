import { Fields } from "../lib/validation";

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
export function parseSignIn(input: unknown): SignInInput {
  const fields = new Fields(input);

  const email = fields.email("email", { max: 200, message: "Enter a valid email address" });
  const password = fields.string("password", {
    max: 200,
    message: "Enter your password",
  });

  fields.done();
  return { email, password };
}
