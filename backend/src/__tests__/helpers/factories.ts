/**
 * Fixture builders.
 *
 * Each test creates exactly the users, submissions and grants it needs, so what a test
 * asserts is readable from the test itself rather than from a shared seed file that
 * every other test also depends on.
 */
import { AppDataSource } from "../../db/data-source";
import type { ShareableRole } from "../../domain/access";
import type { ReviewStatus } from "../../domain/footprint";
import { FootprintShare } from "../../entities/footprint-share.entity";
import { ProductFootprint } from "../../entities/product-footprint.entity";
import { User } from "../../entities/user.entity";
import { Session } from "../../entities/session.entity";
import { SESSION_COOKIE } from "../../middleware/auth";
import { hashPassword, hashSessionToken, SESSION_TTL_MS } from "../../services/auth.service";

let counter = 0;
function unique(): number {
  counter += 1;
  return counter;
}

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
  /** Plaintext password, for tests that exercise the real login endpoint. */
  password: string;
  /** A pre-established session token, for tests that only need to be signed in. */
  sessionToken: string;
}

/**
 * argon2id is deliberately slow. Hashing the same password for every fixture user would
 * add seconds to the suite, so the default password's hash is computed once and reused.
 */
const DEFAULT_PASSWORD = "TestPassword123!";
let defaultHash: string | null = null;

async function passwordHashFor(password: string): Promise<string> {
  if (password !== DEFAULT_PASSWORD) return hashPassword(password);
  defaultHash ??= await hashPassword(DEFAULT_PASSWORD);
  return defaultHash;
}

/**
 * Creates a user *and* a live session for them.
 *
 * Most tests care about what a signed-in user can reach, not about the login handshake,
 * so the session row is inserted directly. The tests that do care about login call
 * `POST /auth/login` with `user.password` instead.
 */
export async function createUser(
  overrides: Partial<Pick<TestUser, "email" | "displayName" | "password">> = {},
): Promise<TestUser> {
  const n = unique();
  const email = overrides.email ?? `user${n}@example.com`;
  const displayName = overrides.displayName ?? `User ${n}`;
  const password = overrides.password ?? DEFAULT_PASSWORD;

  const saved = await AppDataSource.getRepository(User).save(
    AppDataSource.getRepository(User).create({
      email,
      displayName,
      passwordHash: await passwordHashFor(password),
    }),
  );

  const sessionToken = `test-session-${n}-${Math.random().toString(36).slice(2)}`;
  await AppDataSource.getRepository(Session).insert({
    tokenHash: hashSessionToken(sessionToken),
    userId: saved.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  return { id: saved.id, email, displayName, password, sessionToken };
}

export interface CreateFootprintOverrides {
  product?: string;
  supplier?: string;
  category?: string;
  emissionsValue?: number;
  uncertaintyPercent?: number;
  status?: ReviewStatus;
  submittedAt?: Date;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
}

export async function createFootprint(
  ownerId: string,
  overrides: CreateFootprintOverrides = {},
): Promise<ProductFootprint> {
  const n = unique();
  const status = overrides.status ?? "pending";

  // The DB check constraint requires reviewed_at/by to be set iff status is not pending.
  const reviewed = status === "pending" ? null : new Date();

  return AppDataSource.getRepository(ProductFootprint).save(
    AppDataSource.getRepository(ProductFootprint).create({
      ownerId,
      product: overrides.product ?? `Product ${n}`,
      supplier: overrides.supplier ?? `Supplier ${n}`,
      category: overrides.category ?? "Testing",
      emissionsValue: overrides.emissionsValue ?? 10,
      uncertaintyPercent: overrides.uncertaintyPercent ?? 5,
      status,
      submittedAt: overrides.submittedAt ?? new Date(),
      supplierNotes: null,
      reviewComment: null,
      reviewedAt: overrides.reviewedAt !== undefined ? overrides.reviewedAt : reviewed,
      reviewedBy:
        overrides.reviewedBy !== undefined
          ? overrides.reviewedBy
          : status === "pending"
            ? null
            : "Someone",
    }),
  );
}

export async function share(
  footprintId: string,
  userId: string,
  role: ShareableRole,
  grantedById: string,
): Promise<void> {
  await AppDataSource.getRepository(FootprintShare).save(
    AppDataSource.getRepository(FootprintShare).create({
      footprintId,
      userId,
      role,
      grantedById,
    }),
  );
}

/** Session cookie header for a test user, as supertest's `.set()` expects it. */
export function auth(user: TestUser): { Cookie: string } {
  return { Cookie: `${SESSION_COOKIE}=${user.sessionToken}` };
}
