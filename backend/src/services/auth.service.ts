/**
 * Passwords and sessions.
 *
 * Two hashes with opposite requirements live here, which is worth stating plainly:
 *
 *  - **Passwords** use argon2id. A password is a low-entropy, human-chosen secret, so
 *    the hash's job is to be slow and memory-hard enough to make offline guessing
 *    expensive.
 *  - **Session tokens** use SHA-256. A token is 256 bits of CSPRNG output — there is no
 *    dictionary to attack, so a cost factor buys nothing, and the only property needed
 *    is that a leaked database contains no usable cookies.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { LessThan } from "typeorm";
import { AppDataSource } from "../db/data-source";
import { Session } from "../entities/session.entity";
import { User } from "../entities/user.entity";
import { UnauthorizedError } from "../lib/errors";
import { logger } from "../lib/logger";

/** How long a session lasts before it must be re-established by signing in again. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const ARGON2_OPTIONS = { type: argon2.argon2id } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing when the stored value is not a parseable argon2
 * hash — that is what a migration-backfilled placeholder looks like, and such an account
 * must simply be unable to log in.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time comparison of two hex digests. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface SignInResult {
  user: { id: string; email: string; displayName: string };
  /** Plaintext session token. Returned once, set as an httpOnly cookie, never stored. */
  token: string;
  expiresAt: Date;
}

/**
 * Signs a user in.
 *
 * Two details are deliberate and easy to get wrong:
 *
 *  - The failure message and the work done are the **same** whether the email is unknown
 *    or the password is wrong. Returning "no such user" is an account-enumeration
 *    oracle, and skipping the hash comparison when the user is missing is a *timing*
 *    oracle that leaks the same fact.
 *  - The password hash is fetched explicitly, because `select: false` on the column
 *    keeps it out of every other query.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const user = await AppDataSource.getRepository(User)
    .createQueryBuilder("user")
    .addSelect("user.passwordHash")
    .where("LOWER(user.email) = LOWER(:email)", { email })
    .getOne();

  // Hash against a dummy even when the user does not exist, so both paths cost roughly
  // the same wall-clock time.
  const hash = user?.passwordHash ?? (await dummyHash());
  const ok = await verifyPassword(hash, password);

  if (!user || !ok) {
    throw new UnauthorizedError("That email and password do not match an account.");
  }

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await AppDataSource.getRepository(Session).insert({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt,
  });

  // Opportunistic sweep so expired rows do not accumulate forever. Cheap, indexed, and
  // it keeps the app free of a scheduled job for something this small.
  void purgeExpiredSessions().catch((error: unknown) => {
    logger.warn({ event: "session.purge.failed", err: error }, "expired session sweep failed");
  });

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    token,
    expiresAt,
  };
}

/**
 * A real argon2 hash of a fixed string, computed once and reused, so the "unknown email"
 * path performs a comparable verify rather than returning instantly.
 */
let dummyHashCache: string | null = null;
async function dummyHash(): Promise<string> {
  dummyHashCache ??= await hashPassword("this-password-matches-nothing");
  return dummyHashCache;
}

/** Resolves a session token to its user, or null when absent, unknown or expired. */
export async function resolveSession(
  token: string,
): Promise<{ id: string; email: string; displayName: string } | null> {
  const digest = hashSessionToken(token);

  const session = await AppDataSource.getRepository(Session).findOne({
    where: { tokenHash: digest },
    relations: { user: true },
  });

  if (!session || !session.user) return null;
  if (!digestsMatch(session.tokenHash, digest)) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Expired sessions are removed on contact rather than left to the sweep.
    await AppDataSource.getRepository(Session).delete({ id: session.id });
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
  };
}

/** Signs out. Deleting the row is what makes revocation immediate. */
export async function signOut(token: string): Promise<void> {
  await AppDataSource.getRepository(Session).delete({
    tokenHash: hashSessionToken(token),
  });
}

export async function purgeExpiredSessions(): Promise<number> {
  const result = await AppDataSource.getRepository(Session).delete({
    expiresAt: LessThan(new Date()),
  });
  return result.affected ?? 0;
}
