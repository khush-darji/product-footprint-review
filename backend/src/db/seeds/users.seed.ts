/**
 * Development users.
 *
 * The demo accounts all share one password, read from `SEED_PASSWORD` in the environment
 * rather than written here: the value belongs in .env alongside the other credentials, so
 * a deployment that does seed can choose its own without a code change. That the fixture
 * value is public in .env.example is safe only because this seed never runs anywhere
 * real: `seedUsers` refuses to run when NODE_ENV is "production".
 *
 * What is already true here and would stay true in a real deployment: only the argon2id
 * hash is stored, so the database never holds a usable password. What would change is
 * that passwords would be chosen by the user at registration or invite, never handed out
 * in bulk.
 */
import type { DataSource } from "typeorm";
import { config } from "../../config/env";
import { User } from "../../entities/user.entity";
import { hashPassword } from "../../services/auth.service";

export interface SeedUser {
  email: string;
  displayName: string;
}

/**
 * One shared password across the demo accounts, on purpose: the point of switching
 * between them is to see the access model from four angles, and four different passwords
 * to copy would be friction with no security benefit for local fixtures.
 *
 * Throws rather than falling back, so a missing variable is a named, fixable error
 * instead of four accounts silently seeded with a password nobody documented.
 */
export function seedPassword(): string {
  const password = config.seedPassword;
  if (password === undefined) {
    throw new Error(
      "SEED_PASSWORD is not set. Add it to backend/.env (see .env.example) before seeding.",
    );
  }
  return password;
}

export const SEED_USERS: SeedUser[] = [
  { email: "r.osei@example.com", displayName: "R. Osei" },
  { email: "t.adeyemi@example.com", displayName: "T. Adeyemi" },
  { email: "m.lindqvist@example.com", displayName: "M. Lindqvist" },
  { email: "j.park@example.com", displayName: "J. Park" },
];

export async function seedUsers(dataSource: DataSource): Promise<User[]> {
  if (config.isProduction) {
    throw new Error(
      "Refusing to seed users in production: the seed accounts share one known password.",
    );
  }

  const repo = dataSource.getRepository(User);

  // Hashed once and reused: argon2id is deliberately slow, and hashing the same string
  // four times would make the seed noticeably slower for no benefit.
  const passwordHash = await hashPassword(seedPassword());

  for (const seed of SEED_USERS) {
    await repo
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        email: seed.email,
        displayName: seed.displayName,
        passwordHash,
      })
      // Idempotent: re-running the seed resets the password rather than colliding on the
      // unique email index.
      .orUpdate(["display_name", "password_hash"], ["email"])
      .execute();
  }

  return repo.find({ order: { displayName: "ASC" } });
}
