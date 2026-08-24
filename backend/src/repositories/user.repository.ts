/**
 * Queries against `users`.
 *
 * `password_hash` is `select: false` on the entity, so it never leaks into a response by
 * accident. The one place it is needed — the sign-in check in auth.service.ts — asks for
 * it explicitly.
 */
import { AppDataSource } from "../db/data-source";
import type { UserDto } from "../domain/access";
import { User } from "../entities/user.entity";

function repo() {
  return AppDataSource.getRepository(User);
}

export async function findById(id: string): Promise<User | null> {
  return repo().findOne({ where: { id } });
}

export async function findByEmail(email: string): Promise<User | null> {
  // Emails are stored as entered but matched case-insensitively — nobody expects
  // "R.Osei@example.com" and "r.osei@example.com" to be different accounts.
  return repo()
    .createQueryBuilder("user")
    .where("LOWER(user.email) = LOWER(:email)", { email })
    .getOne();
}

/**
 * Everyone, for the "share with…" picker.
 *
 * This is a directory of colleagues in a small internal tool, so it is readable by any
 * authenticated user. In a multi-tenant product it would have to be scoped to the
 * caller's organisation — noted in the README's access-control section.
 */
export async function listAll(): Promise<User[]> {
  return repo().find({ order: { displayName: "ASC" } });
}

export function toUserDto(user: User): UserDto {
  return { id: user.id, email: user.email, displayName: user.displayName };
}
